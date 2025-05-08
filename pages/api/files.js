"use strict";

import { Firestore } from "@google-cloud/firestore";

const firestore = new Firestore({
  projectId: process.env.GCP_PROJECT_ID,
  credentials: JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY),
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = req.headers["x-user-id"] || "default_user";
  const folderId = req.query.folderId;

  try {
    if (folderId) {
      // If folderId is provided, only fetch files for that folder
      const filesSnapshot = await firestore
        .collection("users")
        .doc(userId)
        .collection("documents")
        .where("folder_id", "==", folderId)
        .get();

      const files = filesSnapshot.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().document_name,
        size: doc.data().file_size,
        type: "file",
        folderId: doc.data().folder_id,
        uploadedAt: doc.data().uploaded_timestamp,
      }));

      return res.status(200).json({ files });
      
    } else {
      // For root level, get both folders and files without folderId
      const [foldersSnapshot, filesSnapshot] = await Promise.all([
        firestore
          .collection("users")
          .doc(userId)
          .collection("folders")
          .get(),
        
        firestore
          .collection("users")
          .doc(userId)
          .collection("documents")
          .where("folder_id", "==", null)
          .get()
      ]);

      const folders = foldersSnapshot.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().folder_name,
        type: "folder",
        createdAt: doc.data().created_at,
      }));

      const files = filesSnapshot.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().document_name,
        size: doc.data().file_size,
        type: "file",
        uploadedAt: doc.data().uploaded_timestamp,
      }));

      // Return folders first, then files
      return res.status(200).json({
        items: [...folders, ...files]
      });
    }

  } catch (e) {
    console.error("Error fetching files:", e);
    return res.status(500).json({ error: "Failed to fetch files", details: e.message });
  }
}