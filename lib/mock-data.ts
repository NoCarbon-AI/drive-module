export type Item = {
  id: string
  name: string
  type: "folder" | "file"
  children?: Item[]
}

export const mockData: Item[] = [
  {
    id: "1",
    name: "Documents",
    type: "folder",
    children: [
      { id: "1-1", name: "Report.docx", type: "file" },
      { id: "1-2", name: "Presentation.pptx", type: "file" },
    ],
  },
  {
    id: "2",
    name: "Images",
    type: "folder",
    children: [
      { id: "2-1", name: "Vacation.jpg", type: "file" },
      { id: "2-2", name: "Family.png", type: "file" },
    ],
  },
  { id: "3", name: "Budget.xlsx", type: "file" },
  { id: "4", name: "Project.pdf", type: "file" },
]

