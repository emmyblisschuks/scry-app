export type Workspace = {
  id: string;
  user_id: string;
  name: string;
  subject_tag: string | null;
  created_at: string;
  answer_count?: number;
};

export type QuestionSetStatus = "pending" | "processing" | "done";

export type Material = {
  id: string;
  workspace_id: string;
  file_name: string;
  storage_path: string;
  uploaded_at: string;
};

export type QuestionImage = {
  id: string;
  file: File;
  previewUrl: string;
  isBlurry: boolean;
  ocrText: string;
  status: "pending" | "uploading" | "done" | "error";
};

export type Answer = {
  id: string;
  question_id: string;
  answer_text: string;
  confidence: "high" | "low" | "unsure";
  source_snippet: string | null;
  order_index: number;
};
