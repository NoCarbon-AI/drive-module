import formidable from "formidable";
import fs from "fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Make sure to disable the default body parser in Next.js
export const config = {
  api: {
    bodyParser: false,
  },
};

const s3 = new S3Client({ region: "us-east-1" }); // Use your region

import { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const form = formidable({ multiples: false }); // ✅ correct v3 usage

  form.parse(req, async (err: Error | null, fields: formidable.Fields, files: formidable.Files) => {
    if (err) {
      console.error("Form parse error:", err);
      return res.status(500).json({ error: "File parsing failed" });
    }

    const file = files.file;

    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const fileStream = fs.createReadStream(file[0].filepath); // ✅ Note: file is an array in v3

    const uploadParams = {
      Bucket: "demo-unstructured-io",
      Key: `inputs/${file[0].originalFilename}`,
      Body: fileStream,
    };

    try {
      await s3.send(new PutObjectCommand(uploadParams));
      return res.status(200).json({ message: "File uploaded successfully" });
    } catch (uploadErr) {
      console.error("Upload failed:", uploadErr);
      return res.status(500).json({ error: "S3 upload failed" });
    }
  });
}
