"use client";

import React, { useState, useRef } from "react";
import { mockData, type Item } from "../lib/mock-data"; // Ensure path is correct
import { Folder, File, ChevronRight, Upload, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";

export default function GoogleDriveClone() {
  const [currentFolder, setCurrentFolder] = useState<Item[]>(mockData);
  const [breadcrumbs, setBreadcrumbs] = useState<Item[]>([]);
  const [status, setStatus] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [response, setResponse] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleItemClick = (item: Item) => {
    if (item.type === "folder") {
      setCurrentFolder(item.children || []);
      setBreadcrumbs([...breadcrumbs, item]);
    } else {
      console.log(`Opening file: ${item.name}`);
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === -1) {
      setCurrentFolder(mockData);
      setBreadcrumbs([]);
    } else {
      const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
      setCurrentFolder(newBreadcrumbs[newBreadcrumbs.length - 1].children || []);
      setBreadcrumbs(newBreadcrumbs);
    }
  };

  // Updated function to handle query submission
  const handleQuerySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      setResponse("Please enter a query.");
      return;
    }

    setIsLoading(true);
    setResponse("");

    try {
      const res = await fetch(process.env.CLOUD_URL || "", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          documentId: "example-document-id", // Replace with actual document ID logic
          uuid: "example-uuid", // Replace with actual UUID logic
        }),
      });

      const data = await res.json();
      setResponse(data.response || "No response received from server.");
    } catch (error) {
      setResponse("Error: Failed to fetch response from server.");
      console.error("Error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle file upload button click
  const handleUploadButtonClick = () => {
    fileInputRef.current?.click();
  };

  // Handle file selection
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    handleFileUpload(file);
  };

  // Handle actual file upload
  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setUploadProgress(["Starting upload..."]);

    try {
      // Create FormData
      const formData = new FormData();
      formData.append("file", file);

      // Get user ID from localStorage or use a default
      const userId = localStorage.getItem("userId") || "default_user";

      // Send the file to your API route
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: {
          "x-user-id": userId
        },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Upload failed");
      }

      const result = await response.json();
      
      // Update progress with response data
      setUploadProgress([
        ...result.progress || [],
        `Document ID: ${result.documentId}`,
        `User ID: ${result.userId}`
      ]);

      // Optional: Refresh the file list or add the new file to the UI
      // This would depend on your actual implementation
      console.log("Upload successful:", result);
      
      // Clear the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      
    } catch (error) {
      console.error("Upload error:", error);
      setUploadProgress(prev => [
        ...prev,
        `Error: ${error instanceof Error ? error.message : "Upload failed"}`
      ]);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="container mx-auto p-4 bg-gray-900 min-h-screen">
      <h1 className="text-2xl font-bold mb-4 text-white">Google Drive Clone</h1>

      {/* New Upload Section */}
      <div className="mb-6 bg-gray-800 p-4 rounded-lg">
        <h2 className="text-lg font-semibold text-white mb-2">Upload Files</h2>
        <div className="flex flex-col space-y-4">
          <div className="flex items-center space-x-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
            />
            <Button 
              onClick={handleUploadButtonClick}
              className="bg-green-600 text-white hover:bg-green-700"
              disabled={isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload File
                </>
              )}
            </Button>
          </div>
          
          {/* Upload Progress Display */}
          {uploadProgress.length > 0 && (
            <div className="mt-2 p-3 bg-gray-700 rounded text-sm text-white">
              <h3 className="font-medium mb-1">Upload Progress:</h3>
              <ul className="list-disc pl-5 space-y-1">
                {uploadProgress.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Query Section */}
      <div className="mb-6 bg-gray-800 p-4 rounded-lg">
        <h2 className="text-lg font-semibold text-white mb-2">Query Processor</h2>
        <form onSubmit={handleQuerySubmit} className="space-y-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter your query..."
            className="w-full p-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <Button
            type="submit"
            disabled={isLoading}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {isLoading ? "Processing..." : "Submit Query"}
          </Button>
          <textarea
            value={response}
            readOnly
            placeholder="Response will appear here..."
            className="w-full h-64 p-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:outline-none resize-none"
          />
        </form>
      </div>

      {/* Existing Breadcrumbs */}
      <div className="flex items-center mb-4 space-x-2">
        <Button
          variant="ghost"
          onClick={() => handleBreadcrumbClick(-1)}
          className="text-white"
        >
          Home
        </Button>
        {breadcrumbs.map((item, index) => (
          <React.Fragment key={item.id}>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <Button
              variant="ghost"
              onClick={() => handleBreadcrumbClick(index)}
              className="text-white"
            >
              {item.name}
            </Button>
          </React.Fragment>
        ))}
      </div>

      {/* Existing Folder/File List */}
      <div className="space-y-2">
        {currentFolder.length === 0 ? (
          <p className="text-sm text-gray-400">This folder is empty</p>
        ) : (
          currentFolder.map((item) => (
            <div
              key={item.id}
              className="p-4 border border-gray-700 rounded-lg cursor-pointer hover:bg-gray-800 flex items-center"
              onClick={() => handleItemClick(item)}
            >
              {item.type === "folder" ? (
                <Folder className="w-6 h-6 text-blue-500 mr-4" aria-label="Folder" />
              ) : (
                <File className="w-6 h-6 text-gray-400 mr-4" aria-label="File" />
              )}
              <p className="text-sm text-white">{item.name}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}