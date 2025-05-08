"use strict";
import { Storage } from '@google-cloud/storage';
import fetch from 'node-fetch';

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
  
  firestore = new Firestore({
    projectId: process.env.GCP_PROJECT_ID,
    credentials: serviceAccountKey,
    ignoreUndefinedProperties: true,
    timestampsInSnapshots: true
  });
  
  console.log('Firestore initialized successfully');
} catch (e) {
  console.error('Error initializing Firestore:', e);
  throw new Error('Failed to initialize Firestore: ' + e.message);
}

const bucketName = process.env.GCP_BUCKET_NAME;
const bucket = storage.bucket(bucketName);

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { documentId } = req.body;
    const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;

    if (!documentId) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    console.log('Starting delete operation for document:', documentId);

    // First get the document metadata from Firestore
    const docRef = firestore.collection('users')
      .doc(userId)
      .collection('documents')
      .doc(documentId);

    const docSnapshot = await docRef.get();
    
    if (!docSnapshot.exists) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const documentData = docSnapshot.data();
    console.log('Found document metadata:', documentData);

    // Delete from all sources in parallel
    await Promise.all([
      // 1. Delete from Firestore
      docRef.delete().then(() => {
        console.log('✅ Deleted from Firestore');
      }).catch(e => {
        console.error('Failed to delete from Firestore:', e);
        throw e;
      }),

      // 2. Delete from Cloud Storage
      (async () => {
        const filePath = `${userId}/${documentId}/${documentData.document_name}`;
        try {
          await bucket.file(filePath).delete();
          console.log('✅ Deleted from Cloud Storage:', filePath);
        } catch (e) {
          if (e.code !== 404) {
            console.error('Failed to delete from Cloud Storage:', e);
            throw e;
          }
        }
      })(),

      // 3. Delete from Qdrant
      (async () => {
        const collectionName = `user_${userId}_collection`;
        const deleteResponse = await fetch(`${process.env.QDRANT_URL}/collections/${collectionName}/points/delete`, {
          method: 'POST',
          headers: {
            'api-key': process.env.QDRANT_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: {
              must: [
                {
                  key: "document_id",
                  match: {
                    value: documentId
                  }
                }
              ]
            }
          }),
        });

        if (!deleteResponse.ok) {
          const error = await deleteResponse.json();
          console.error('Failed to delete from Qdrant:', error);
          throw new Error(`Qdrant deletion failed: ${JSON.stringify(error)}`);
        }
        console.log('✅ Deleted from Qdrant');
      })()
    ]);

    // Update the UI by removing the file from state
    return res.status(200).json({
      message: 'Document deleted successfully from all sources',
      documentId,
      userId
    });

  } catch (error) {
    console.error('❌ Delete operation failed:', error);
    return res.status(500).json({
      error: 'Delete operation failed',
      details: error.message
    });
  }
}