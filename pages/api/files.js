"use strict";

// Default user ID to use as fallback
const DEFAULT_USER_ID = "default_user";

// Initialize Firestore
let firestore;
try {
  const { Firestore } = require('@google-cloud/firestore');
  const serviceAccountKey = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY);
  
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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get user ID from request header
    let userId = req.headers['x-user-id'];
    if (!userId) {
      console.log('No user ID provided, using default user ID');
      userId = DEFAULT_USER_ID;
    }
    console.log('Fetching files for User ID:', userId);

    // Fetch documents from Firestore
    const documentsRef = firestore.collection('users')
      .doc(userId)
      .collection('documents');
    
    const snapshot = await documentsRef.get();
    
    if (snapshot.empty) {
      console.log('No documents found for this user');
      return res.status(200).json({ files: [] });
    }

    // Process document data
    const files = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      files.push({
        id: doc.id,
        name: data.document_name || 'Unnamed Document',
        size: data.file_size || 0,
        type: data.mime_type || 'application/octet-stream',
        uploadedAt: data.uploaded_timestamp || '',
        ...data // Include any additional fields
      });
    });

    console.log(`Found ${files.length} documents for user ${userId}`);
    return res.status(200).json({ files });
  } catch (err) {
    console.error('❌ Error fetching files:', err);
    return res.status(500).json({ 
      error: 'Failed to fetch files',
      details: err.message 
    });
  }
}