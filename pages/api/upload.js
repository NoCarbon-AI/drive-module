"use strict"; // Ensure module behavior
import formidable from 'formidable';
import fs from 'fs';
import { Storage } from '@google-cloud/storage';
import { UnstructuredClient } from 'unstructured-client';
import { Strategy } from 'unstructured-client/sdk/models/shared';
import { v4 as uuidv4 } from 'uuid'; // Add UUID package for generating unique IDs

// Default user ID to use as fallback
const DEFAULT_USER_ID = "default_user";

// Initialize Google Cloud Storage client
const serviceAccountKey = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
  credentials: serviceAccountKey
});

// Initialize Firestore
let firestore;
try {
  const { Firestore } = require('@google-cloud/firestore');
  
  // Create Firestore with explicit settings to avoid issues
  firestore = new Firestore({
    projectId: process.env.GCP_PROJECT_ID,
    credentials: serviceAccountKey,
    ignoreUndefinedProperties: true, // Helps with potential undefined values
    timestampsInSnapshots: true // Ensure timestamps are handled correctly
  });
  
  console.log('Firestore initialized successfully');
} catch (e) {
  console.error('Error initializing Firestore:', e);
  throw new Error('Failed to initialize Firestore: ' + e.message);
}

const bucketName = process.env.GCP_BUCKET_NAME;
const bucket = storage.bucket(bucketName);

let qdrantClient;
try {
  console.log('Attempting to load qdrant-client module...');
  const qdrantModule = require('qdrant-client'); // qdrant-client supports CommonJS
  console.log('qdrant-client module loaded:', Object.keys(qdrantModule));

  if (!qdrantModule.HttpClient) {
    console.error('HttpClient class not found in qdrant-client module');
    throw new Error('HttpClient class not exported by qdrant-client');
  }

  const fetch = (await import('node-fetch')).default; // Dynamic ESM import for node-fetch
  console.log('Initializing Qdrant HttpClient with URL:', process.env.QDRANT_URL);
  qdrantClient = new qdrantModule.HttpClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    timeout: 60,
  });
  console.log('Connected to Qdrant cluster successfully');
  console.log('Qdrant client instance methods:', Object.keys(qdrantClient));
} catch (e) {
  console.error('Qdrant client initialization error:', e.message || e);
  throw new Error('Failed to initialize Qdrant client: ' + (e.message || e));
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const form = formidable({ multiples: false });
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

    // Get the user ID from the request headers or use default if not provided
    let userId = req.headers['x-user-id'];
    if (!userId) {
      console.log('No user ID provided, using default user ID');
      userId = DEFAULT_USER_ID;
    }
    console.log('User ID:', userId);

    // Generate a document ID (separate for each document)
    const documentId = uuidv4();
    console.log('Document ID:', documentId);

    // Step 1: Upload to GCP bucket
    inputFileName = file.originalFilename;
    gcsFile = bucket.file(inputFileName);

    const fileContent = await fs.promises.readFile(tempFilePath);
    await gcsFile.save(fileContent);
    const inputUrl = `https://storage.googleapis.com/${bucketName}/${inputFileName}`;
    console.log('✅ Uploaded to GCP bucket:', inputUrl);
    progress.push('Uploaded to GCP bucket');

    // Step 2: Process with Unstructured
    const serverUrl = process.env.UNSTRUCTURED_API_URL;
    const apiKey = process.env.UNSTRUCTURED_API_KEY;
    if (!apiKey) {
      throw new Error('UNSTRUCTURED_API_KEY is not set in .env');
    }
    console.log('Initializing UnstructuredClient with serverURL:', serverUrl);

    const client = new UnstructuredClient({
      security: { apiKeyAuth: apiKey },
      serverURL: serverUrl,
      retryConfig: {
        strategy: 'backoff',
        retryConnectionErrors: true,
        backoff: {
          initialInterval: 1000,
          maxInterval: 60000,
          exponent: 1.5,
          maxElapsedTime: 1200000,
        },
        maxRetries: 3,
      },
    });

    const data = await fs.promises.readFile(tempFilePath);
    console.log('Sending file to Unstructured:', inputFileName);
    progress.push('Creating paging');

    const partitionResponse = await client.general.partition({
      partitionParameters: {
        files: {
          content: data,
          fileName: inputFileName,
        },
        strategy: Strategy.HiRes,
        splitPdfPage: true,
        splitPdfAllowFailed: true,
        splitPdfConcurrencyLevel: 15,
        languages: ['eng'],
      },
    }).catch((e) => {
      console.error('Partition Error:', e);
      if (e.statusCode) {
        console.error('Status Code:', e.statusCode);
        console.error('Body:', e.body);
      } else {
        console.error('Raw Error:', e);
      }
      throw e;
    });

    console.log('Raw Partition Response:', JSON.stringify(partitionResponse, null, 2));
    let elements = [];
    let statusCode = 200;
    if (Array.isArray(partitionResponse)) {
      elements = partitionResponse;
    } else if (partitionResponse && typeof partitionResponse === 'object' && 'elements' in partitionResponse) {
      elements = partitionResponse.elements || [];
      statusCode = partitionResponse.statusCode || 200;
    } else {
      throw new Error('Unexpected partition response format');
    }

    if (statusCode !== 200) {
      throw new Error(`Partition failed with status ${statusCode}: ${JSON.stringify(elements)}`);
    }

    // Step 3: Generate Embeddings with Hugging Face Inference API
    progress.push('Generating embeddings');
    const texts = elements.map(e => e.text || '');
    const embeddings = await generateEmbeddingsWithHuggingFace(texts);
    console.log('Embeddings generated:', embeddings.length, 'vectors');

    // Step 4: Store in Qdrant
    const qdrant = qdrantClient;
    const collectionName = `user_${userId}_collection`;
    progress.push('Storing in Qdrant');

    // Check if collection exists, create if needed
    try {
      let collectionsResponse;
      try {
        collectionsResponse = await fetch(`${process.env.QDRANT_URL}/collections/${collectionName}`, {
          method: 'GET',
          headers: {
            'api-key': process.env.QDRANT_API_KEY,
            'Content-Type': 'application/json',
          },
        });
        console.log('Collection check response status:', collectionsResponse.status);
      } catch (e) {
        console.log('Collection check failed, assuming it doesn\'t exist:', e.message);
      }

      if (!collectionsResponse || collectionsResponse.status !== 200) {
        console.log('Creating new collection:', collectionName);
        const createResponse = await fetch(`${process.env.QDRANT_URL}/collections/${collectionName}`, {
          method: 'PUT',
          headers: {
            'api-key': process.env.QDRANT_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            vectors: {
              size: 384,  // all-MiniLM-L6-v2 produces 384-dimensional vectors
              distance: 'Cosine',
            },
          }),
        });
        const createResult = await createResponse.json();
        console.log('Create collection response:', createResult);
        if (!createResponse.ok) {
          throw new Error(`Failed to create collection: ${createResult.status || createResult.message}`);
        }
      } else {
        console.log('Collection already exists:', collectionName);
        
        // Delete any previous data with the same file name to prevent duplicates
        try {
          console.log(`Checking for existing points with file_name: ${inputFileName}`);
          const searchResponse = await fetch(`${process.env.QDRANT_URL}/collections/${collectionName}/points/scroll`, {
            method: 'POST',
            headers: {
              'api-key': process.env.QDRANT_API_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filter: {
                must: [
                  {
                    key: "file_name",
                    match: {
                      value: inputFileName
                    }
                  }
                ]
              },
              limit: 1000
            }),
          });
          
          const searchResult = await searchResponse.json();
          if (searchResponse.ok && searchResult.points && searchResult.points.length > 0) {
            console.log(`Found ${searchResult.points.length} existing points for file ${inputFileName}`);
            
            // Extract point IDs for deletion
            const pointIdsToDelete = searchResult.points.map(point => point.id);
            
            // Delete points
            if (pointIdsToDelete.length > 0) {
              const deleteResponse = await fetch(`${process.env.QDRANT_URL}/collections/${collectionName}/points/delete`, {
                method: 'POST',
                headers: {
                  'api-key': process.env.QDRANT_API_KEY,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  points: pointIdsToDelete
                }),
              });
              
              const deleteResult = await deleteResponse.json();
              console.log(`Deleted ${pointIdsToDelete.length} existing points:`, deleteResult);
            }
          }
        } catch (e) {
          console.error('Error checking for existing points:', e);
          // Continue with upload anyway
        }
      }
    } catch (e) {
      console.error('Collection creation/check error:', e);
      throw new Error('Failed to manage Qdrant collection: ' + (e.message || e));
    }

    // Prepare points for Qdrant with document ID
    const points = elements.map((element, index) => ({
      id: uuidv4(), // Use a new UUID for each point
      vector: embeddings[index],
      payload: {
        text: element.text || '',
        metadata: element.metadata || {},
        element_type: element.type || 'unknown',
        document_id: documentId,
        user_id: userId,
        file_name: inputFileName,
        document_name: inputFileName, // Explicitly store document_name in payload
        created_at: new Date().toISOString()
      },
    }));
    console.log('Points to upload:', points.slice(0, 2));

    // Batch upload points via REST API
    const batchSize = 10;
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      try {
        const uploadResponse = await fetch(`${process.env.QDRANT_URL}/collections/${collectionName}/points`, {
          method: 'PUT',
          headers: {
            'api-key': process.env.QDRANT_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            points: batch,
          }),
        });
        const uploadResult = await uploadResponse.json();
        console.log(`Uploaded batch ${i / batchSize + 1}/${Math.ceil(points.length / batchSize)}:`, uploadResult);
        if (!uploadResponse.ok) {
          console.error('Upload error details:', uploadResult);
          throw new Error(`Failed to upload batch: ${uploadResult.status?.error || uploadResult.message || 'Unknown error'}`);
        }
      } catch (e) {
        console.error(`Error uploading batch ${i / batchSize + 1}:`, e);
        throw new Error('Failed to upload points to Qdrant: ' + (e.message || e));
      }
    }
    console.log('Vectors stored in Qdrant collection:', collectionName);
    
    // Step 5: Store document metadata in Firestore
// Step 5: Store document metadata in Firestore
try {
  progress.push('Storing document metadata in Firestore');
  
  // Ensure all numbers are JavaScript numbers, not Long
  const safeFileSize = Number(file.size) || 0;

  // Create document data with only string and number types (no Date objects)
  const documentData = {
    document_id: documentId,
    document_name: inputFileName,
    file_size: safeFileSize, // Explicitly convert to Number
    uploaded_timestamp: new Date().toISOString(), // Store as ISO string
    mime_type: file.mimetype || 'application/octet-stream'
  };
  
  // Store the document in Firestore under the hierarchical structure: users/{user_id}/documents/{document_id}
  await firestore.collection('users')
    .doc(userId)
    .collection('documents')
    .doc(documentId)
    .set(documentData, { merge: true }); // Use merge to avoid overwriting
  
  console.log(`✅ Document metadata stored in Firestore: userId=${userId}, documentId=${documentId}`);
  console.log('Document data stored:', documentData);
} catch (e) {
  console.error('Error storing document metadata in Firestore:', e);
  console.error('Error details:', e.message);
  console.error('Error stack:', e.stack);
  progress.push('Warning: Failed to store document metadata in Firestore');
  // Continue with success response anyway, as the main processing succeeded
}

    // Final success message
    progress.push('File processed successfully');
    return res.status(200).json({
      message: 'Upload, processing, and vector storage successful',
      progress,
      collectionName,
      project: process.env.GCP_PROJECT_ID,
      documentId,
      userId,
      documentName: inputFileName
    });
  } catch (err) {
    console.error('❌ Error:', err.message || err);
    progress.push(`Error: ${err.message || 'Failed to process upload'}`);
    
    // If there was an error, try to clean up the GCP bucket file if it was created
    if (gcsFile) {
      try {
        await gcsFile.delete();
        console.log(`✅ Cleaned up file ${inputFileName} from GCP bucket after error`);
      } catch (cleanupErr) {
        console.error('Failed to clean up GCP file after error:', cleanupErr);
      }
    }
    
    return res.status(500).json({ error: err.message || 'Failed to process upload', progress });
  } finally {
    if (tempFilePath) {
      fs.promises.unlink(tempFilePath).catch((err) => console.error('Temp file cleanup error:', err));
    }
  }
}

// Function to generate embeddings using Hugging Face Inference API
async function generateEmbeddingsWithHuggingFace(texts) {
  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    throw new Error('HUGGINGFACE_API_KEY is not set in .env');
  }
  const apiUrl = process.env.HUGGINGFACE_API_URL || 'https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2';

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Hugging Face API error: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  // The API returns a list of embeddings, one per input text
  return data;
}
