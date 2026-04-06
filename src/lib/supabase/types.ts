// ============================================================
// Supabase Database Types — V4
// Updated for V4 schema: working_memory, fingerprint,
// structured_summary, anti_memory, document_registry, etc.
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
        Insert: {
          id: string;
          email?: string | null;
          name?: string | null;
          avatar_url?: string | null;
          language?: string;
          expertise?: string;
          preferred_model?: string;
          preferences?: Json;
          daily_message_limit?: number;
          messages_today?: number;
          last_reset_date?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          name?: string | null;
          avatar_url?: string | null;
          language?: string;
          expertise?: string;
          preferred_model?: string;
          preferences?: Json;
          daily_message_limit?: number;
          messages_today?: number;
          last_reset_date?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
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
          // V4 columns (optional — not always selected to avoid vector serialization issues)
          working_memory?: Json;
          document_registry?: Json;
          fingerprint?: number[] | null;
          structured_summary?: Json | null;
          gemini_cache_name?: string | null;
          key_entities?: string[];
          key_topics?: string[];
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string;
          model?: string;
          summary?: string | null;
          system_prompt?: string | null;
          topic?: string | null;
          message_count?: number;
          is_pinned?: boolean;
          share_token?: string | null;
          is_public?: boolean;
          folder_id?: string | null;
          created_at?: string;
          updated_at?: string;
          working_memory?: Json;
          document_registry?: Json;
          fingerprint?: number[] | null;
          structured_summary?: Json | null;
          gemini_cache_name?: string | null;
          key_entities?: string[];
          key_topics?: string[];
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          model?: string;
          summary?: string | null;
          system_prompt?: string | null;
          topic?: string | null;
          message_count?: number;
          is_pinned?: boolean;
          share_token?: string | null;
          is_public?: boolean;
          folder_id?: string | null;
          created_at?: string;
          updated_at?: string;
          working_memory?: Json;
          document_registry?: Json;
          fingerprint?: number[] | null;
          structured_summary?: Json | null;
          gemini_cache_name?: string | null;
          key_entities?: string[];
          key_topics?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "conversations_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          }
        ];
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
        Insert: {
          id?: string;
          conversation_id: string;
          role: 'user' | 'assistant' | 'system';
          content: string;
          content_blocks?: Json | null;
          model?: string | null;
          token_count?: number | null;
          attachments?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          role?: 'user' | 'assistant' | 'system';
          content?: string;
          content_blocks?: Json | null;
          model?: string | null;
          token_count?: number | null;
          attachments?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          }
        ];
      };
      memories: {
        Row: {
          id: string;
          user_id: string;
          type: 'fact' | 'preference' | 'goal' | 'skill' | 'opinion' | 'rejection' | 'correction' | 'constraint' | 'anti_memory';
          content: string;
          confidence: number;
          source_conversation_id: string | null;
          created_at: string;
          // V4 columns
          is_active: boolean;
          valid_until: string | null;
          invalidated_by: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: 'fact' | 'preference' | 'goal' | 'skill' | 'opinion' | 'rejection' | 'correction' | 'constraint' | 'anti_memory';
          content: string;
          confidence?: number;
          source_conversation_id?: string | null;
          created_at?: string;
          is_active?: boolean;
          valid_until?: string | null;
          invalidated_by?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          type?: 'fact' | 'preference' | 'goal' | 'skill' | 'opinion' | 'rejection' | 'correction' | 'constraint' | 'anti_memory';
          content?: string;
          confidence?: number;
          source_conversation_id?: string | null;
          created_at?: string;
          is_active?: boolean;
          valid_until?: string | null;
          invalidated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "memories_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memories_source_conversation_id_fkey";
            columns: ["source_conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          }
        ];
      };
      embeddings: {
        Row: {
          id: number;
          user_id: string;
          source_type: 'message' | 'fact' | 'document' | 'summary' | 'anti_memory';
          source_id: string | null;
          content: string;
          embedding: number[];
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: number;
          user_id: string;
          source_type: 'message' | 'fact' | 'document' | 'summary' | 'anti_memory';
          source_id?: string | null;
          content: string;
          embedding: number[];
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: number;
          user_id?: string;
          source_type?: 'message' | 'fact' | 'document' | 'summary' | 'anti_memory';
          source_id?: string | null;
          content?: string;
          embedding?: number[];
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "embeddings_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
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
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          icon?: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          icon?: string;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "folders_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
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
        Insert: {
          id?: string;
          user_id: string;
          entity_name: string;
          entity_type: string;
          properties?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          entity_name?: string;
          entity_type?: string;
          properties?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_entities_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
      user_entity_relations: {
        Row: {
          id: string;
          user_id: string;
          from_entity_id: string;
          to_entity_id: string;
          relation_type: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          from_entity_id: string;
          to_entity_id: string;
          relation_type: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          from_entity_id?: string;
          to_entity_id?: string;
          relation_type?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_entity_relations_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_entity_relations_from_entity_id_fkey";
            columns: ["from_entity_id"];
            isOneToOne: false;
            referencedRelation: "user_entities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_entity_relations_to_entity_id_fkey";
            columns: ["to_entity_id"];
            isOneToOne: false;
            referencedRelation: "user_entities";
            referencedColumns: ["id"];
          }
        ];
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
        Insert: {
          id?: number;
          user_id: string;
          model: string;
          input_tokens?: number;
          output_tokens?: number;
          cost_usd?: number;
          endpoint: string;
          created_at?: string;
        };
        Update: {
          id?: number;
          user_id?: string;
          model?: string;
          input_tokens?: number;
          output_tokens?: number;
          cost_usd?: number;
          endpoint?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usage_logs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
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
          source_id: string | null;
          metadata: Json;
          created_at: string;
          score: number;
        }>;
      };
      hybrid_search_scoped: {
        Args: {
          query_text: string;
          query_embedding: number[];
          target_user_id: string;
          conversation_ids: string[];
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
          source_id: string | null;
          metadata: Json;
          created_at: string;
          score: number;
        }>;
      };
      find_similar_memory: {
        Args: {
          target_user_id: string;
          query_embedding: number[];
          similarity_threshold?: number;
        };
        Returns: Array<{
          id: string;
          content: string;
          confidence: number;
          similarity: number;
        }>;
      };
      search_similar_conversations: {
        Args: {
          query_embedding_256: number[];
          target_user_id: string;
          match_count?: number;
        };
        Returns: Array<{
          id: string;
          title: string;
          topic: string;
          similarity: number;
          message_count: number;
        }>;
      };
      cleanup_memories_v4: {
        Args: {
          target_user_id: string;
        };
        Returns: void;
      };
      get_user_memory_stats: {
        Args: {
          target_user_id: string;
        };
        Returns: Array<{
          active_count: number;
          inactive_count: number;
          total_count: number;
          avg_confidence: number;
        }>;
      };
      get_conversation_embedding_stats: {
        Args: {
          target_conversation_id: string;
        };
        Returns: Array<{
          source_type: string;
          embedding_count: number;
          avg_embedding_norm: number;
        }>;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

// Convenience type aliases
export type User = Database['public']['Tables']['users']['Row'];
export type Conversation = Database['public']['Tables']['conversations']['Row'];
export type Message = Database['public']['Tables']['messages']['Row'];
export type Memory = Database['public']['Tables']['memories']['Row'];
export type Folder = Database['public']['Tables']['folders']['Row'];
export type Embedding = Database['public']['Tables']['embeddings']['Row'];
export type UserEntity = Database['public']['Tables']['user_entities']['Row'];
export type UserEntityRelation = Database['public']['Tables']['user_entity_relations']['Row'];
export type UsageLog = Database['public']['Tables']['usage_logs']['Row'];
