"use client";

import React, { useState, useRef, useEffect } from "react";
import { mockData, type Item } from "../lib/mock-data"; // Ensure path is correct
import { Folder, File, ChevronRight, Upload, Loader2, MoreVertical, Trash2, RefreshCw } from "lucide-react";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

// Define a type for uploaded files
interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
}

export default function GoogleDriveClone() {
  const [currentFolder, setCurrentFolder] = useState<Item[]>(mockData);
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string, name: string }>>([]);
  const [currentItems, setCurrentItems] = useState<Array<any>>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [response, setResponse] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [isDeletingFile, setIsDeletingFile] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null); // Track selected folder
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Update the fetchFolderContents function
  const fetchFolderContents = async (folderId: string | null) => {
    setIsLoadingFiles(true);
    try {
      const userId = localStorage.getItem("userId") || "default_user";
      const url = `/api/files${folderId ? `?folderId=${folderId}` : ''}`;
      
      const response = await fetch(url, {
        headers: { "x-user-id": userId }
      });
      
      if (!response.ok) throw new Error("Failed to fetch folder contents");
      
      const data = await response.json();
      
      if (folderId) {
        // Inside a folder - show only files
        setCurrentItems(data.files || []);
      } else {
        // Root level - show both folders and files
        const items = data.items || [];
        setCurrentItems(items);
        // Update uploadedFiles with folders for the folder selection section
        setUploadedFiles(items.filter((item: UploadedFile) => item.type === "folder"));
      }
    } catch (error) {
      console.error("Error fetching folder contents:", error);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  // Fetch user's files on component mount
  useEffect(() => {
    fetchFolderContents(currentFolderId);
  }, [currentFolderId]);

  const handleDeleteFile = async (fileId: string) => {
    setIsDeletingFile(fileId);
    try {
      const userId = localStorage.getItem("userId") || "default_user";
      
      const response = await fetch("/api/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": userId
        },
        body: JSON.stringify({ documentId: fileId })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete file");
      }

      // Remove file from both states
      setCurrentItems(prev => prev.filter(item => item.id !== fileId));
      setUploadedFiles(prev => prev.filter(file => file.id !== fileId));
      
      if (selectedDocumentId === fileId) {
        setSelectedDocumentId(null);
      }

    } catch (error) {
      console.error("Error deleting file:", error);
      alert("Failed to delete file. Please try again.");
    } finally {
      setIsDeletingFile(null);
    }
  };

  const handleItemClick = (item: Item) => {
    if (item.type === "folder") {
      setCurrentFolder(item.children || []);
      setBreadcrumbs([...breadcrumbs, item]);
    } else {
      console.log(`Opening file: ${item.name}`);
    }
  };

  // Update handleFolderClick to properly handle navigation
  const handleFolderClick = async (folder: any) => {
    setCurrentFolderId(folder.id);
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }]);
    await fetchFolderContents(folder.id);
  };

  const handleBreadcrumbClick = async (index: number) => {
    if (index === -1) {
      setCurrentFolderId(null);
      setBreadcrumbs([]);
    } else {
      const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
      setBreadcrumbs(newBreadcrumbs);
      setCurrentFolderId(newBreadcrumbs[newBreadcrumbs.length - 1].id);
    }
  };

  // Handle file selection for query
  const handleFileSelect = (fileId: string) => {
    setSelectedDocumentId(fileId === selectedDocumentId ? null : fileId);
  };

  // Function to create a new folder
  const handleCreateFolder = async () => {
    const folderName = prompt("Enter folder name:");
    if (!folderName) return;

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
        throw new Error("Failed to create folder");
      }

      fetchFolderContents(currentFolderId); // Refresh file list
    } catch (error) {
      console.error("Error creating folder:", error);
      alert("Failed to create folder. Please try again.");
    }
  };

  // Handle folder selection
  const handleFolderSelect = (folderId: string) => {
    setSelectedFolderId((prevFolderId) => (prevFolderId === folderId ? null : folderId));
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
        const userId = localStorage.getItem("userId") || "default_user";
        
        // Prepare request body with updated structure
        const requestBody: any = {
            query,
            user_uuid: userId,
            search_params: {
                user_id: userId
            }
        };
        
        // Add folder-specific or document-specific search parameters
        if (selectedFolderId) {
            requestBody.search_params.folder_id = selectedFolderId;
        } else if (selectedDocumentId) {
            requestBody.search_params.document_id = selectedDocumentId;
        }
        
        const cloudRunUrl = process.env.NEXT_PUBLIC_CLOUD_RUN_URL || "https://mcp-987835613654.us-east1.run.app";
        
        const res = await fetch(cloudRunUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || "Failed to get response from server");
        }

        const data = await res.json();
        setResponse(data.response || "No response received from server.");
    } catch (error) {
        console.error("Error:", error);
        setResponse(`Error: ${error instanceof Error ? error.message : "Failed to fetch response from server."}`);
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

  // Update handleFileUpload function
  const handleFileUpload = async (file: File) => {
    if (!selectedFolderId) {
      alert("Please select a folder before uploading a file.");
      return;
    }

    setIsUploading(true);
    setUploadProgress(["Starting upload..."]);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folderId", selectedFolderId); // Add folder ID to form data

      const userId = localStorage.getItem("userId") || "default_user";

      const response = await fetch("/api/upload", {
        method: "POST",
        headers: {
          "x-user-id": userId
        },
        body: formData
      });

      if (!response.ok) {
        let errorMessage = "Upload failed";
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (parseError) {
          const errorText = await response.text();
          errorMessage = errorText || `Upload failed with status ${response.status}`;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      
      setUploadProgress([
        ...result.progress || [],
        `Document ID: ${result.documentId}`,
        `User ID: ${result.userId}`,
        `Folder ID: ${selectedFolderId}`
      ]);

      // Refresh the current folder contents
      await fetchFolderContents(selectedFolderId);
      
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

  // Format file size in a readable way
  const formatFileSize = (sizeInBytes: number): string => {
    if (sizeInBytes < 1024) return `${sizeInBytes} bytes`;
    if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(1)} KB`;
    return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Format date in a readable way
  const formatDate = (dateString: string): string => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return dateString;
    }
  };

  return (
    <div className="container mx-auto p-4 bg-gray-900 min-h-screen">
      <h1 className="text-2xl font-bold mb-4 text-white">Google Drive Clone</h1>

      {/* Folder Creation Section */}
      <div className="mb-6 bg-gray-800 p-4 rounded-lg">
        <h2 className="text-lg font-semibold text-white mb-2">Manage Folders</h2>
        <Button
          onClick={handleCreateFolder}
          className="bg-blue-600 text-white hover:bg-blue-700"
        >
          Create Folder
        </Button>
      </div>

      {/* Folder Selection */}
      <div className="mb-6 bg-gray-800 p-4 rounded-lg">
        <h2 className="text-lg font-semibold text-white mb-2">Your Folders</h2>
        <div className="space-y-2">
          {uploadedFiles
            .filter((file) => file.type === "folder")
            .map((folder) => (
              <div
                key={folder.id}
                className={`p-4 border rounded-lg flex items-center justify-between cursor-pointer ${
                  selectedFolderId === folder.id
                    ? "bg-blue-700 border-blue-500 text-white" // Highlight selected folder
                    : "bg-gray-800 border-gray-700 text-gray-300" // Default style
                }`}
                onClick={() => handleFolderSelect(folder.id)}
              >
                <div className="flex items-center">
                  <Folder className="w-6 h-6 mr-4" />
                  <p className="text-sm">{folder.name}</p>
                </div>
                {selectedFolderId === folder.id && (
                  <span className="text-xs text-blue-300">Selected</span>
                )}
              </div>
            ))}
        </div>

        {selectedFolderId && (
          <div className="mt-4 p-4 bg-gray-800 rounded-lg">
            <p className="text-sm text-gray-300">
              Selected Folder:{" "}
              <span className="text-blue-400 font-semibold">
                {uploadedFiles.find((folder) => folder.id === selectedFolderId)?.name}
              </span>
            </p>
          </div>
        )}
      </div>

      {/* Upload Section */}
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

      {/* Uploaded Files Section */}
      <div className="mb-6 bg-gray-800 p-4 rounded-lg">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-white">
            {currentFolderId ? `Contents of ${breadcrumbs[breadcrumbs.length - 1]?.name}` : 'Your Files'}
          </h2>
          <Button 
            variant="ghost" 
            onClick={() => fetchFolderContents(currentFolderId)}
            disabled={isLoadingFiles}
            className="text-white border-gray-600 hover:bg-gray-700"
          >
            {isLoadingFiles ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
        
        {isLoadingFiles ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : currentItems.length === 0 ? (
          <p className="text-gray-400 text-center p-6">
            {currentFolderId ? 'This folder is empty' : 'No files or folders yet'}
          </p>
        ) : (
          <div className="space-y-2">
            {currentItems.map((item) => (
              <div 
                key={item.id} 
                className={`p-4 border border-gray-700 rounded-lg flex items-center justify-between hover:bg-gray-800 ${
                  selectedDocumentId === item.id ? "bg-gray-700 border-blue-500" : ""
                }`}
                onClick={() => handleFileSelect(item.id)}
              >
                <div className="flex items-center">
                  {item.type === "folder" ? (
                    <Folder className={`w-6 h-6 ${selectedFolderId === item.id ? "text-blue-500" : "text-gray-400"} mr-4`} />
                  ) : (
                    <File className={`w-6 h-6 ${selectedDocumentId === item.id ? "text-blue-500" : "text-gray-400"} mr-4`} />
                  )}
                  <div className="flex flex-col">
                    <p className="text-sm text-white font-medium">
                      {item.name || item.document_name || "Untitled"} {/* Add fallback name */}
                    </p>
                    {item.type === "file" && (
                      <div className="flex items-center text-xs text-gray-400 mt-1">
                        <span>{formatFileSize(item.size)}</span>
                        <span className="mx-2">•</span>
                        <span>{formatDate(item.uploadedAt)}</span>
                      </div>
                    )}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
                      {isDeletingFile === item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                      ) : (
                        <MoreVertical className="h-4 w-4 text-gray-400" />
                      )}
                      <span className="sr-only">Open menu</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-36">
                    <DropdownMenuItem 
                      className="text-red-500 focus:text-red-500 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFile(item.id);
                      }}
                      disabled={isDeletingFile === item.id}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Query Section */}
      <div className="mb-6 bg-gray-800 p-4 rounded-lg">
        <h2 className="text-lg font-semibold text-white mb-2">Query Your Documents</h2>
        {selectedFolderId || selectedDocumentId ? (
          <div className="bg-blue-900/30 p-2 rounded-md mb-3 flex items-center">
            {selectedFolderId ? (
              <>
                <Folder className="text-blue-400 w-4 h-4 mr-2" />
                <span className="text-sm text-blue-200">
                  Querying folder: {currentItems.find(f => f.id === selectedFolderId)?.name}
                </span>
              </>
            ) : (
              <>
                <File className="text-blue-400 w-4 h-4 mr-2" />
                <span className="text-sm text-blue-200">
                  Querying file: {currentItems.find(f => f.id === selectedDocumentId)?.name}
                </span>
              </>
            )}
          </div>
        ) : (
          <div className="bg-gray-700/50 p-2 rounded-md mb-3 text-sm text-gray-300">
            Select a folder or file above to query it specifically, or submit a query to search all documents.
          </div>
        )}
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
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              "Submit Query"
            )}
          </Button>
          <textarea
            value={response}
            readOnly
            placeholder="Response will appear here..."
            className="w-full h-64 p-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:outline-none resize-none"
          />
        </form>
      </div>

      {/* Breadcrumbs */}
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

      {/* Files and Folders List */}
      <div className="space-y-2">
        {isLoadingFiles ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        ) : currentItems.length === 0 ? (
          <p className="text-gray-400 text-center p-6">This folder is empty</p>
        ) : (
          currentItems.map((item) => (
            <div
              key={item.id}
              className={`p-4 border border-gray-700 rounded-lg flex items-center justify-between hover:bg-gray-800 cursor-pointer ${
                (selectedFolderId === item.id || selectedDocumentId === item.id)
                  ? "bg-gray-700 border-blue-500"
                  : ""
              }`}
              onClick={() => {
                if (item.type === "folder") {
                  if (item.id === selectedFolderId) {
                    // If folder is already selected, navigate into it
                    handleFolderClick(item);
                  } else {
                    // Otherwise, select the folder
                    handleFolderSelect(item.id);
                  }
                } else {
                  handleFileSelect(item.id);
                }
              }}
            >
              <div className="flex items-center">
                {item.type === "folder" ? (
                  <Folder className={`w-6 h-6 ${selectedFolderId === item.id ? "text-blue-500" : "text-gray-400"} mr-4`} />
                ) : (
                  <File className={`w-6 h-6 ${selectedDocumentId === item.id ? "text-blue-500" : "text-gray-400"} mr-4`} />
                )}
                <div className="flex flex-col">
                  <p className="text-sm text-white font-medium">
                    {item.name || item.document_name || "Untitled"} {/* Add fallback name */}
                  </p>
                  {item.type === "file" && (
                    <div className="flex items-center text-xs text-gray-400 mt-1">
                      <span>{formatFileSize(item.size)}</span>
                      <span className="mx-2">•</span>
                      <span>{formatDate(item.uploadedAt)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}