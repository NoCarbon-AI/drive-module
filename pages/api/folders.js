"use strict";

import { v4 as uuidv4 } from "uuid";
import { Firestore } from "@google-cloud/firestore";

const firestore = new Firestore({
  projectId: process.env.GCP_PROJECT_ID,
  credentials: JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY),
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { folderName } = req.body;
  const userId = req.headers["x-user-id"] || "default_user";

  if (!folderName) {
    return res.status(400).json({ error: "Folder name is required" });
  }

  try {
    const folderId = uuidv4();
    await firestore
      .collection("users")
      .doc(userId)
      .collection("folders")
      .doc(folderId)
      .set({
        folder_id: folderId,
        folder_name: folderName,
        created_at: new Date().toISOString(),
      });

    console.log(`✅ Folder created: userId=${userId}, folderId=${folderId}`);
    return res.status(200).json({ folderId, folderName });
  } catch (e) {
    console.error("Error creating folder:", e);
    return res.status(500).json({ error: "Failed to create folder", details: e.message });
  }
}