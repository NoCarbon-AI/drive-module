"use client"

import { useRef } from "react"
import { Button } from "@/components/ui/button"

export default function FileUploader() {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append("file", file)

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      const data = await res.json()
      if (res.ok) {
        alert("✅ File uploaded successfully to S3!")
        console.log("Uploaded:", data)
      } else {
        alert("❌ Upload failed")
        console.error("Upload failed:", data)
      }
    } catch (error) {
      console.error("Error uploading file:", error)
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={() => inputRef.current?.click()}>
        Upload File to S3
      </Button>
      <input
        ref={inputRef}
        type="file"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  )
}
