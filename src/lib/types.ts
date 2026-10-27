export type Workspace = {
  id: string;
  user_id: string;
  name: string;
  subject_tag: string | null;
  created_at: string;
  answer_count?: number;
  // newest finished question set that has answers; the card opens it directly
  latest_set_id?: string | null;
};

export type QuestionSetStatus = "pending" | "processing" | "done" | "error";

export type Material = {
  id: string;
  workspace_id: string;
  file_name: string;
  storage_path: string | null; // null once the original upload was cleaned up
  uploaded_at: string;
  content_hash: string | null;
  indexed_at: string | null;
  chunks_from: string | null;
  file_deleted_at: string | null;
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
