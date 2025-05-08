"use strict";

import formidable from 'formidable';
import fs from 'fs';
import { Storage } from '@google-cloud/storage';
import { UnstructuredClient } from 'unstructured-client';
import { Strategy } from 'unstructured-client/sdk/models/shared';
import { v4 as uuidv4 } from 'uuid';
import pRetry from 'p-retry';

const DEFAULT_USER_ID = "default_user";

const serviceAccountKey = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
  credentials: serviceAccountKey
});

let firestore;
try {
  const { Firestore } = require('@google-cloud/firestore');
  firestore = new Firestore({
    projectId: process.env.GCP_PROJECT_ID,
    credentials: serviceAccountKey,
    ignoreUndefinedProperties: true,
  });
} catch (e) {
  console.error('Error initializing Firestore:', e);
  throw new Error('Failed to initialize Firestore: ' + e.message);
}

const bucketName = process.env.GCP_BUCKET_NAME;
const bucket = storage.bucket(bucketName);

const GCP_EMBEDDING_ENDPOINT = process.env.GCP_ENDPOINT;

let qdrantClient;
try {
  const fetchModule = await import('node-fetch');
  const fetch = fetchModule.default;
  qdrantClient = {
    fetch: async (endpoint, method, body) => {
      const url = `${process.env.QDRANT_URL}${endpoint}`;
      const options = {
        method: method,
        headers: {
          'api-key': process.env.QDRANT_API_KEY,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined
      };
      return fetch(url, options);
    }
  };
} catch (e) {
  console.error('Qdrant client initialization error:', e.message || e);
  throw new Error('Failed to initialize Qdrant client: ' + (e.message || e));
}

export const config = {
  api: {
    bodyParser: false,
  },
};

function estimateTokens(text) {
  return Math.ceil(text.length / 3.5);
}

function chunkTextByTokenEstimate(text, maxTokens) {
  const safeMaxTokens = Math.floor(maxTokens * 0.85);
  const maxChars = Math.floor(safeMaxTokens * 3.5);
  
  if (estimateTokens(text) <= safeMaxTokens) {
    return [text];
  }
  
  const chunks = [];
  let currentIdx = 0;
  
  while (currentIdx < text.length) {
    let chunkEnd = currentIdx + maxChars;
    let chunk = text.substring(currentIdx, chunkEnd);
    
    if (chunkEnd < text.length) {
      const breakingPoints = [
        chunk.lastIndexOf('. '),
        chunk.lastIndexOf('? '),
        chunk.lastIndexOf('! '),
        chunk.lastIndexOf('\n'),
        chunk.lastIndexOf('; '),
        chunk.lastIndexOf(': '),
        chunk.lastIndexOf(',')
      ];
      
      const minBreakPos = Math.floor(maxChars * 0.5);
      let breakPoint = -1;
      
      for (const point of breakingPoints) {
        if (point > minBreakPos && (breakPoint === -1 || point > breakPoint)) {
          breakPoint = point;
        }
      }
      
      if (breakPoint > 0) {
        chunk = text.substring(currentIdx, currentIdx + breakPoint + 1);
        currentIdx += breakPoint + 1;
      } else {
        const lastSpace = chunk.lastIndexOf(' ');
        if (lastSpace > minBreakPos) {
          chunk = text.substring(currentIdx, currentIdx + lastSpace);
          currentIdx += lastSpace + 1;
        } else {
          currentIdx += maxChars;
        }
      }
    } else {
      currentIdx = text.length;
    }
    
    const trimmedChunk = chunk.trim();
    
    if (trimmedChunk && estimateTokens(trimmedChunk) <= maxTokens) {
      chunks.push(trimmedChunk);
    } else if (trimmedChunk) {
      const subChunks = chunkTextByTokenEstimate(trimmedChunk, maxTokens);
      chunks.push(...subChunks);
    }
  }
  
  return chunks;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const form = formidable({
    multiples: false,
    keepExtensions: true,
    hashAlgorithm: false,
  });

  let tempFilePath;
  let progress = [];
  let gcsFile;
  let inputFileName;

  try {
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve({ fields, files });
      });
    });

    const file = files.file?.[0];
    if (!file || !file.filepath) {
      return res.status(400).json({ error: 'No file uploaded or invalid file structure' });
    }
    tempFilePath = file.filepath;

    let userId = req.headers['x-user-id'] || DEFAULT_USER_ID;
    const documentId = uuidv4();
    inputFileName = file.originalFilename || `upload-${documentId}`;
    gcsFile = bucket.file(`${userId}/${documentId}/${inputFileName}`);

    const fileContent = await fs.promises.readFile(tempFilePath);
    await gcsFile.save(fileContent);
    progress.push('Uploaded to GCP bucket');

    const serverUrl = process.env.UNSTRUCTURED_API_URL;
    const unstructuredApiKey = process.env.UNSTRUCTURED_API_KEY;
    if (!unstructuredApiKey) {
      throw new Error('UNSTRUCTURED_API_KEY is not set in .env');
    }

    const unstructuredClient = new UnstructuredClient({
      security: { apiKeyAuth: unstructuredApiKey },
      serverURL: serverUrl,
      retryConfig: {
        strategy: 'backoff',
        retryConnectionErrors: true,
        backoff: { initialInterval: 1000, maxInterval: 60000, exponent: 1.5, maxElapsedTime: 1200000 },
        maxRetries: 3,
      },
    });

    progress.push('Processing document with Unstructured');

    const partitionResponse = await unstructuredClient.general.partition({
      partitionParameters: {
        files: { content: fileContent, fileName: inputFileName },
        strategy: Strategy.HiRes,
        splitPdfPage: true,
        languages: ['eng'],
        chunkingStrategy: "by_title",
        combineUnderNChars: 150,
        newAfterNChars: 600,
        maxCharacters: 800
      },
    }).catch((e) => {
      console.error('Unstructured Partition Error:', e);
      if (e.statusCode && e.body) {
        throw new Error(`Unstructured Partition failed with status ${e.statusCode}: ${JSON.stringify(e.body)}`);
      }
      throw new Error(`Unstructured Partition failed: ${e.message || e}`);
    });

    let elements = (partitionResponse?.elements && Array.isArray(partitionResponse.elements)) ? partitionResponse.elements : (Array.isArray(partitionResponse) ? partitionResponse : []);
    if (elements.length === 0) {
      console.warn('No elements returned from Unstructured.');
    }

    progress.push('Generating embeddings with GCP Embedding API');
    const texts = elements.map(e => e.text || '').filter(text => text.trim() !== '');
    if (texts.length === 0) {
      console.warn('No valid text elements for embedding.');
    }

    const processedTexts = [];
    const elementMetadata = [];
    const elementTypes = [];
    const MAX_TOKENS_PER_CHUNK = 150;
    
    texts.forEach((text, index) => {
      const chunks = chunkTextByTokenEstimate(text, MAX_TOKENS_PER_CHUNK);
      chunks.forEach(chunk => {
        const tokenCount = estimateTokens(chunk);
        if (tokenCount > MAX_TOKENS_PER_CHUNK) {
          console.warn(`Chunk exceeds token limit: ${tokenCount} tokens. Skipping.`);
          return;
        }
        processedTexts.push(chunk);
        elementMetadata.push(elements[index]?.metadata || {});
        elementTypes.push(elements[index]?.type || 'unknown');
      });
    });

    let embeddings = [];
    if (processedTexts.length > 0) {
      embeddings = await generateEmbeddingsWithGCP(processedTexts);
    }

    const collectionName = `user_${userId}_collection`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    progress.push('Preparing to store in Qdrant');

    try {
      let collectionsResponse = await qdrantClient.fetch(`/collections/${collectionName}`, 'GET');
      if (collectionsResponse.status !== 200) {
        const createResponse = await qdrantClient.fetch(`/collections/${collectionName}`, 'PUT', {
          vectors: { size: 384, distance: 'Cosine' },
        });
        const createResult = await createResponse.json();
        if (!createResponse.ok) throw new Error(`Failed to create collection: ${JSON.stringify(createResult.status || createResult.message)}`);
      } else {
        const deleteFilter = { filter: { must: [{ key: "document_id", match: { value: documentId } }] } };
        const deletePointsResponse = await qdrantClient.fetch(`/collections/${collectionName}/points/delete`, 'POST', deleteFilter);
        if (!deletePointsResponse.ok) {
          console.warn(`Failed to delete existing points for document ${documentId}: Status ${deletePointsResponse.status}`);
        }
      }
    } catch (e) {
      console.error('Qdrant collection management error:', e);
      throw new Error('Failed to manage Qdrant collection: ' + (e.message || e));
    }

    if (embeddings.length > 0 && processedTexts.length === embeddings.length) {
      const points = processedTexts.map((text, index) => {
        if (!embeddings[index] || embeddings[index].length !== 384) {
          console.warn(`Invalid embedding at index ${index}. Skipping.`);
          return null;
        }
        return {
          id: uuidv4(),
          vector: embeddings[index],
          payload: {
            text: text,
            metadata: elementMetadata[index] || {},
            element_type: elementTypes[index] || 'unknown',
            document_id: documentId,
            user_id: userId,
            file_name: inputFileName,
            folder_id: fields.folderId || null,
            created_at: new Date().toISOString()
          },
        };
      }).filter(point => point !== null);

      if (points.length > 0) {
        const batchSize = 100;
        for (let i = 0; i < points.length; i += batchSize) {
          const batch = points.slice(i, i + batchSize);
          try {
            const uploadResponse = await qdrantClient.fetch(`/collections/${collectionName}/points?wait=true`, 'PUT', { points: batch });
            const uploadResult = await uploadResponse.json();
            if (!uploadResponse.ok || uploadResult.status?.error) {
              console.error('Qdrant upload error:', uploadResult);
              throw new Error(`Failed to upload batch to Qdrant: ${uploadResult.status?.error || 'Unknown Qdrant error'}`);
            }
          } catch (e) {
            console.error(`Error uploading Qdrant batch ${Math.floor(i / batchSize) + 1}:`, e);
            throw new Error('Failed to upload points to Qdrant: ' + (e.message || e));
          }
        }
        progress.push('Stored in Qdrant');
      } else {
        progress.push('No valid points to upload to Qdrant.');
      }
    } else if (processedTexts.length > 0 && embeddings.length !== processedTexts.length) {
      console.error('Mismatch between texts and embeddings. Skipping Qdrant upload.');
      progress.push('Error: Text/embedding mismatch, Qdrant upload skipped.');
    } else {
      progress.push('No embeddings to store in Qdrant.');
    }

    try {
      progress.push('Storing document metadata in Firestore');
      const safeFileSize = Number(file.size) || 0;
      const documentData = {
        document_id: documentId, document_name: inputFileName, file_size: safeFileSize,
        uploaded_timestamp: new Date().toISOString(), mime_type: file.mimetype || 'application/octet-stream',
        gcs_path: gcsFile.name, user_id: userId, status: 'processed',
        chunk_count: processedTexts.length,
        vector_count: embeddings.filter(e => e !== null).length,
        qdrant_collection_name: collectionName
      };
      await firestore.collection('users').doc(userId).collection('documents').doc(documentId).set(documentData, { merge: true });
    } catch (e) {
      console.error('Error storing document metadata in Firestore:', e.message);
      progress.push('Warning: Failed to store document metadata in Firestore');
    }

    progress.push('File processed successfully');
    return res.status(200).json({
      message: 'Upload, processing, and vector storage successful',
      progress, collectionName, documentId, userId, documentName: inputFileName
    });

  } catch (err) {
    console.error('Main Handler Error:', err.message || err);
    progress.push(`Error: ${err.message || 'Failed to process upload'}`);
    if (gcsFile) {
      try { await gcsFile.delete(); } catch (cleanupErr) { console.error('Failed to clean up GCS file:', cleanupErr); }
    }
    return res.status(500).json({ error: err.message || 'Failed to process upload', progress });
  } finally {
    if (tempFilePath) {
      fs.promises.unlink(tempFilePath).catch((err) => console.error('Temp file cleanup error:', err));
    }
  }
}

async function generateEmbeddingsWithGCP(texts) {
  const allEmbeddings = [];
  try {
    const fetchModule = await import('node-fetch');
    const fetch = fetchModule.default;
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({
      credentials: serviceAccountKey,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    const gcpClient = await auth.getClient();
    const authToken = (await gcpClient.getAccessToken()).token;

    if (!authToken) throw new Error('Failed to obtain access token for GCP');

    const BATCH_SIZE = 8;
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const textBatch = texts.slice(i, i + BATCH_SIZE);
      const instances = textBatch.map(textToEmbed => ({
        inputs: textToEmbed 
      }));
      const payload = { instances };

      const retryOptions = {
        retries: 3,
        onFailedAttempt: error => {
          console.warn(`Embedding API attempt ${error.attemptNumber} failed for batch starting at index ${i}. ${error.retriesLeft} retries left. Error: ${error.message}`);
        }
      };

      const result = await pRetry(async () => {
        const response = await fetch(GCP_EMBEDDING_ENDPOINT, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          console.error(`GCP Embedding API Error (Status ${response.status}) for batch starting at index ${i}:`, errorBody);
          const err = new Error(`GCP Embedding API error: ${response.status} - ${errorBody}`);
          err.statusCode = response.status;
          throw err; 
        }
        return await response.json();
      }, retryOptions);

      if (result.predictions && Array.isArray(result.predictions)) {
        result.predictions.forEach((prediction, batchIndex) => {
          if (prediction.embeddings && Array.isArray(prediction.embeddings.values) && prediction.embeddings.values.length === 384) {
            allEmbeddings.push(prediction.embeddings.values);
          } else if (Array.isArray(prediction.embedding) && prediction.embedding.length === 384) {
            allEmbeddings.push(prediction.embedding);
          } else if (Array.isArray(prediction) && prediction.length > 0 && Array.isArray(prediction[0]) && prediction[0].length === 384 && prediction[0].every(num => typeof num === 'number')) {
            allEmbeddings.push(prediction[0]); 
          } else if (Array.isArray(prediction) && prediction.length === 384 && prediction.every(num => typeof num === 'number')) {
            allEmbeddings.push(prediction);
          } else {
            console.error(`Invalid prediction structure at index ${i + batchIndex}.`);
            allEmbeddings.push(null); 
          }
        });
      } else {
        console.error(`No valid predictions for batch starting at index ${i}.`);
        textBatch.forEach(() => allEmbeddings.push(null));
      }
    }
    return allEmbeddings.filter(emb => emb !== null && emb.length === 384);
  } catch (error) {
    console.error('Error in generateEmbeddingsWithGCP:', error.message);
    throw error;
  }
}

async function handleFileUpload(file, userId, folderId) {
  try {
    const documentId = uuidv4();
    const localFilePath = file.filepath;
    const [fileUrl] = await bucket.upload(localFilePath, {
      destination: `${userId}/${documentId}/${file.originalname}`
    });

    await generateAndStoreEmbeddings(/*...*/);

    await bucket.file(`${userId}/${documentId}/${file.originalname}`).delete();

    return {
      success: true,
      documentId,
      progress: ['File processed successfully', 'Embeddings generated', 'Original file cleaned up']
    };
  } catch (error) {
    console.error('Error in upload process:', error);
    throw error;
  }
}