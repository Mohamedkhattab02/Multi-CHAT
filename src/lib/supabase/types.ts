// ============================================================
// Supabase Database Types
// Generated from schema — update with: supabase gen types typescript
// ============================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string | null;
          name: string | null;
          avatar_url: string | null;
          language: string;
          expertise: string;
          preferred_model: string;
          preferences: Json;
          daily_message_limit: number;
          messages_today: number;
          last_reset_date: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['users']['Insert']>;
      };
      conversations: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          model: string;
          summary: string | null;
          system_prompt: string | null;
          topic: string | null;
          message_count: number;
          is_pinned: boolean;
          share_token: string | null;
          is_public: boolean;
          folder_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['conversations']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['conversations']['Insert']>;
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          role: 'user' | 'assistant' | 'system';
          content: string;
          content_blocks: Json | null;
          model: string | null;
          token_count: number | null;
          attachments: Json;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['messages']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['messages']['Insert']>;
      };
      memories: {
        Row: {
          id: string;
          user_id: string;
          type: 'fact' | 'preference' | 'goal' | 'skill' | 'opinion';
          content: string;
          confidence: number;
          source_conversation_id: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['memories']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['memories']['Insert']>;
      };
      embeddings: {
        Row: {
          id: number;
          user_id: string;
          source_type: 'message' | 'fact' | 'document' | 'summary';
          source_id: string | null;
          content: string;
          embedding: number[];
          metadata: Json;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['embeddings']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['embeddings']['Insert']>;
      };
      folders: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          icon: string;
          sort_order: number;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['folders']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['folders']['Insert']>;
      };
      user_entities: {
        Row: {
          id: string;
          user_id: string;
          entity_name: string;
          entity_type: string;
          properties: Json;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['user_entities']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['user_entities']['Insert']>;
      };
      usage_logs: {
        Row: {
          id: number;
          user_id: string;
          model: string;
          input_tokens: number;
          output_tokens: number;
          cost_usd: number;
          endpoint: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['usage_logs']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['usage_logs']['Insert']>;
      };
    };
    Functions: {
      hybrid_search: {
        Args: {
          query_text: string;
          query_embedding: number[];
          target_user_id: string;
          match_count?: number;
          full_text_weight?: number;
          semantic_weight?: number;
          fuzzy_weight?: number;
          rrf_k?: number;
        };
        Returns: Array<{
          id: number;
          content: string;
          source_type: string;
          metadata: Json;
          created_at: string;
          score: number;
        }>;
      };
    };
  };
}

// Convenience type aliases
export type User = Database['public']['Tables']['users']['Row'];
export type Conversation = Database['public']['Tables']['conversations']['Row'];
export type Message = Database['public']['Tables']['messages']['Row'];
export type Memory = Database['public']['Tables']['memories']['Row'];
export type Folder = Database['public']['Tables']['folders']['Row'];
export type UsageLog = Database['public']['Tables']['usage_logs']['Row'];
