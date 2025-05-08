import { useState, useEffect } from 'react';
import { Folder } from 'lucide-react';

export default function FolderManager() {
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  useEffect(() => {
    fetchUserFiles();
  }, []);

  const handleFolderSelect = (folderId) => {
    setSelectedFolderId((prevFolderId) => (prevFolderId === folderId ? null : folderId));
  };

  const handleFileUpload = async (file) => {
    if (!selectedFolderId) {
      alert("Please select a folder before uploading a file.");
      return;
    }

    setIsUploading(true);
    setUploadProgress(["Starting upload..."]);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folderId", selectedFolderId); // Include folder ID

      const userId = localStorage.getItem("userId") || "default_user";

      const response = await fetch("/api/upload", {
        method: "POST",
        headers: {
          "x-user-id": userId,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Upload failed");
      }

      const result = await response.json();
      setUploadProgress([...uploadProgress, ...(result.progress || []), `Document ID: ${result.documentId}`]);
      fetchUserFiles(); // Refresh file list
    } catch (error) {
      console.error("Upload error:", error);
      setUploadProgress((prev) => [...prev, `Error: ${error.message || "Upload failed"}`]);
    } finally {
      setIsUploading(false);
    }
  };

  const fetchUserFiles = async () => {
    setIsLoadingFiles(true);
    try {
      const userId = localStorage.getItem("userId") || "default_user";
      const response = await fetch("/api/files", {
        method: "GET",
        headers: {
          "x-user-id": userId,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch files");
      }

      const data = await response.json();
      setUploadedFiles(data.files); // Update state with folders and files
    } catch (error) {
      console.error("Error fetching files:", error);
      alert("Failed to fetch files. Please try again.");
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const createFolder = async (folderName) => {
    try {
      const userId = localStorage.getItem("userId") || "default_user";
      const response = await fetch("/api/folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": userId,
        },
        body: JSON.stringify({ folderName }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create folder");
      }

      await fetchUserFiles(); // Refresh file list after creating folder
    } catch (error) {
      console.error("Error creating folder:", error);
      alert("Failed to create folder. Please try again.");
    }
  };

  return (
    <div className="space-y-4">
      {/* Folder creation form could go here */}
      
      {/* Folder list */}
      <div className="space-y-2">
        {uploadedFiles
          .filter((file) => file.type === "folder")
          .map((folder) => (
            <div
              key={folder.id}
              className={`p-4 border border-gray-700 rounded-lg flex items-center justify-between hover:bg-gray-800 ${
                selectedFolderId === folder.id ? "bg-gray-700 border-blue-500" : ""
              }`}
              onClick={() => handleFolderSelect(folder.id)}
            >
              <Folder className="w-6 h-6 text-blue-500 mr-4" />
              <p className="text-sm text-white">{folder.name}</p>
            </div>
          ))}
      </div>

      {/* File upload UI and progress could go here */}
    </div>
  );
}