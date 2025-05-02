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
    // Extract document details from request
    const { documentId, fileName } = req.body;
    if (!documentId) {
      return res.status(400).json({ error: 'Document ID is required' });
    }

    // Get user ID from request header
    let userId = req.headers['x-user-id'];
    if (!userId) {
      console.log('No user ID provided, using default user ID');
      userId = DEFAULT_USER_ID;
    }
    console.log('Delete request for User ID:', userId, 'Document ID:', documentId);

    // Step 1: Delete document metadata from Firestore
    try {
      await firestore.collection('users')
        .doc(userId)
        .collection('documents')
        .doc(documentId)
        .delete();
      
      console.log(`✅ Document metadata deleted from Firestore: userId=${userId}, documentId=${documentId}`);
    } catch (e) {
      console.error('Error deleting document from Firestore:', e);
      return res.status(500).json({ 
        error: 'Failed to delete document metadata from Firestore', 
        details: e.message 
      });
    }

    // Step 2: Delete file from GCP bucket if fileName is provided
    if (fileName) {
      try {
        const file = bucket.file(fileName);
        await file.delete();
        console.log(`✅ File ${fileName} deleted from GCP bucket`);
      } catch (e) {
        console.error('Error deleting file from GCP bucket:', e);
        // Continue with deletion process even if file deletion fails
      }
    }

    // Step 3: Delete vectors from Qdrant
    const collectionName = `user_${userId}_collection`;
    try {
      // Delete points with matching document_id from Qdrant collection
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
      
      const deleteResult = await deleteResponse.json();
      console.log(`✅ Vector data deleted from Qdrant:`, deleteResult);
      
      if (!deleteResponse.ok) {
        throw new Error(`Failed to delete from Qdrant: ${JSON.stringify(deleteResult)}`);
      }
    } catch (e) {
      console.error('Error deleting vectors from Qdrant:', e);
      return res.status(500).json({
        error: 'Failed to delete vector data from Qdrant',
        details: e.message
      });
    }

    return res.status(200).json({
      message: 'Document deleted successfully',
      documentId,
      userId
    });
  } catch (err) {
    console.error('❌ Error during deletion:', err);
    return res.status(500).json({ 
      error: 'Failed to delete document',
      details: err.message 
    });
  }
}