export enum TaskStatus {
  Pending = 'pending',
  Active = 'active',
  WaitingReply = 'waiting_reply',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Expired = 'expired',
}

export enum TaskType {
  Review = 'review',
  Debug = 'debug',
  Test = 'test',
  Question = 'question',
  Implement = 'implement',
}

export type MessageKind = 'request' | 'reply' | 'note';

export interface Task {
  id: string;
  task_type: TaskType;
  sender: string;
  receiver: string;
  status: TaskStatus;
  summary: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export interface Message {
  id: string;
  task_id: string;
  author: string;
  kind: MessageKind;
  content: string;
  created_at: string;
}

export interface Artifact {
  id: string;
  task_id: string;
  message_id: string;
  filename: string;
  type: string;
  size: number;
  checksum: string;
  path: string;
  created_at: string;
}

export interface Agent {
  name: string;
  role: string;
  client: string;
  last_seen: string;
}

export interface CreateTaskInput {
  task_type: TaskType;
  sender: string;
  receiver: string;
  summary: string;
  expires_at?: string | null;
}

export interface CreateMessageInput {
  task_id: string;
  author: string;
  kind: MessageKind;
  content: string;
}

export interface CreateArtifactInput {
  task_id: string;
  message_id: string;
  filename: string;
  type: string;
  size: number;
  checksum: string;
  path: string;
}
