export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      beta_feedback: {
        Row: {
          created_at: string
          email: string | null
          handled: boolean
          id: string
          message: string
          page_url: string | null
          search_query: string | null
          user_agent: string | null
          user_id: string | null
          viewport: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          handled?: boolean
          id?: string
          message: string
          page_url?: string | null
          search_query?: string | null
          user_agent?: string | null
          user_id?: string | null
          viewport?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          handled?: boolean
          id?: string
          message?: string
          page_url?: string | null
          search_query?: string | null
          user_agent?: string | null
          user_id?: string | null
          viewport?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      discovery_queue: {
        Row: {
          author: string | null
          candidate_rank: number
          category: string | null
          created_at: string
          description: string | null
          episode_count: number | null
          id: string
          image_url: string | null
          import_error: string | null
          import_status: string | null
          imported_at: string | null
          imported_podcast_id: string | null
          language: string | null
          last_episode_at: string | null
          last_import_attempt_at: string | null
          pi_id: number | null
          rank_reason: Json
          rss_url: string
          source: string | null
          status: string
          title: string
          updated_at: string
          website_url: string | null
        }
        Insert: {
          author?: string | null
          candidate_rank?: number
          category?: string | null
          created_at?: string
          description?: string | null
          episode_count?: number | null
          id?: string
          image_url?: string | null
          import_error?: string | null
          import_status?: string | null
          imported_at?: string | null
          imported_podcast_id?: string | null
          language?: string | null
          last_episode_at?: string | null
          last_import_attempt_at?: string | null
          pi_id?: number | null
          rank_reason?: Json
          rss_url: string
          source?: string | null
          status?: string
          title: string
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          author?: string | null
          candidate_rank?: number
          category?: string | null
          created_at?: string
          description?: string | null
          episode_count?: number | null
          id?: string
          image_url?: string | null
          import_error?: string | null
          import_status?: string | null
          imported_at?: string | null
          imported_podcast_id?: string | null
          language?: string | null
          last_episode_at?: string | null
          last_import_attempt_at?: string | null
          pi_id?: number | null
          rank_reason?: Json
          rss_url?: string
          source?: string | null
          status?: string
          title?: string
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      episodes: {
        Row: {
          apple_url: string | null
          audio_url: string | null
          companies: string[] | null
          created_at: string
          description: string | null
          episode_rank: number
          episode_rank_label: string | null
          episode_rank_reason: Json
          episode_rank_updated_at: string | null
          episode_url: string | null
          guid: string | null
          id: string
          image_url: string | null
          ingredients: string[] | null
          people: string[] | null
          podcast_id: string
          published_at: string | null
          slug: string
          spotify_url: string | null
          summary: string | null
          tickers: string[] | null
          title: string
          topics: string[] | null
          updated_at: string
          youtube_url: string | null
        }
        Insert: {
          apple_url?: string | null
          audio_url?: string | null
          companies?: string[] | null
          created_at?: string
          description?: string | null
          episode_rank?: number
          episode_rank_label?: string | null
          episode_rank_reason?: Json
          episode_rank_updated_at?: string | null
          episode_url?: string | null
          guid?: string | null
          id?: string
          image_url?: string | null
          ingredients?: string[] | null
          people?: string[] | null
          podcast_id: string
          published_at?: string | null
          slug: string
          spotify_url?: string | null
          summary?: string | null
          tickers?: string[] | null
          title: string
          topics?: string[] | null
          updated_at?: string
          youtube_url?: string | null
        }
        Update: {
          apple_url?: string | null
          audio_url?: string | null
          companies?: string[] | null
          created_at?: string
          description?: string | null
          episode_rank?: number
          episode_rank_label?: string | null
          episode_rank_reason?: Json
          episode_rank_updated_at?: string | null
          episode_url?: string | null
          guid?: string | null
          id?: string
          image_url?: string | null
          ingredients?: string[] | null
          people?: string[] | null
          podcast_id?: string
          published_at?: string | null
          slug?: string
          spotify_url?: string | null
          summary?: string | null
          tickers?: string[] | null
          title?: string
          topics?: string[] | null
          updated_at?: string
          youtube_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "episodes_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          ok: boolean
          started_at: string
          stats: Json
          trigger: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          ok?: boolean
          started_at?: string
          stats?: Json
          trigger?: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          ok?: boolean
          started_at?: string
          stats?: Json
          trigger?: string
        }
        Relationships: []
      }
      pi_dump_imports: {
        Row: {
          auto_added: number
          candidates_accepted: number
          candidates_rejected: number
          created_at: string
          failed_rss_tests: number
          feeds_received: number
          feeds_scanned: number
          hidden_low_rank: number
          id: string
          notes: Json
          queued: number
          skipped_duplicates: number
          snapshot_date: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          auto_added?: number
          candidates_accepted?: number
          candidates_rejected?: number
          created_at?: string
          failed_rss_tests?: number
          feeds_received?: number
          feeds_scanned?: number
          hidden_low_rank?: number
          id?: string
          notes?: Json
          queued?: number
          skipped_duplicates?: number
          snapshot_date?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          auto_added?: number
          candidates_accepted?: number
          candidates_rejected?: number
          created_at?: string
          failed_rss_tests?: number
          feeds_received?: number
          feeds_scanned?: number
          hidden_low_rank?: number
          id?: string
          notes?: Json
          queued?: number
          skipped_duplicates?: number
          snapshot_date?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      pi_feed_staging: {
        Row: {
          author: string | null
          created_at: string
          dead: boolean
          decision: string | null
          description: string | null
          episode_count: number | null
          id: string
          image_url: string | null
          import_id: string | null
          language: string | null
          last_http_status: number | null
          newest_item_at: string | null
          pi_id: number | null
          processed: boolean
          processed_at: string | null
          reject_reason: string | null
          rss_url: string
          score: number | null
          title: string | null
          website_url: string | null
        }
        Insert: {
          author?: string | null
          created_at?: string
          dead?: boolean
          decision?: string | null
          description?: string | null
          episode_count?: number | null
          id?: string
          image_url?: string | null
          import_id?: string | null
          language?: string | null
          last_http_status?: number | null
          newest_item_at?: string | null
          pi_id?: number | null
          processed?: boolean
          processed_at?: string | null
          reject_reason?: string | null
          rss_url: string
          score?: number | null
          title?: string | null
          website_url?: string | null
        }
        Update: {
          author?: string | null
          created_at?: string
          dead?: boolean
          decision?: string | null
          description?: string | null
          episode_count?: number | null
          id?: string
          image_url?: string | null
          import_id?: string | null
          language?: string | null
          last_http_status?: number | null
          newest_item_at?: string | null
          pi_id?: number | null
          processed?: boolean
          processed_at?: string | null
          reject_reason?: string | null
          rss_url?: string
          score?: number | null
          title?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pi_feed_staging_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "pi_dump_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      podcasts: {
        Row: {
          apple_url: string | null
          category: string | null
          country: string | null
          created_at: string
          deep_hydration_error: string | null
          deep_hydration_status: string
          deep_hydration_target: number | null
          description: string | null
          featured: boolean
          featured_rank: number | null
          hydrated_episode_count: number
          id: string
          image_url: string | null
          is_sample: boolean
          language: string | null
          last_deep_hydrated_at: string | null
          last_fetch_duplicate_count: number
          last_fetch_error: string | null
          last_fetch_new_count: number
          last_fetched_at: string | null
          manual_rank_boost: number
          podiverzum_rank: number
          rank_label: string | null
          rank_reason: Json
          rank_updated_at: string | null
          rss_status: string
          rss_url: string | null
          slug: string
          source: string | null
          spotify_url: string | null
          summary: string | null
          title: string
          updated_at: string
          website_url: string | null
          youtube_url: string | null
        }
        Insert: {
          apple_url?: string | null
          category?: string | null
          country?: string | null
          created_at?: string
          deep_hydration_error?: string | null
          deep_hydration_status?: string
          deep_hydration_target?: number | null
          description?: string | null
          featured?: boolean
          featured_rank?: number | null
          hydrated_episode_count?: number
          id?: string
          image_url?: string | null
          is_sample?: boolean
          language?: string | null
          last_deep_hydrated_at?: string | null
          last_fetch_duplicate_count?: number
          last_fetch_error?: string | null
          last_fetch_new_count?: number
          last_fetched_at?: string | null
          manual_rank_boost?: number
          podiverzum_rank?: number
          rank_label?: string | null
          rank_reason?: Json
          rank_updated_at?: string | null
          rss_status?: string
          rss_url?: string | null
          slug: string
          source?: string | null
          spotify_url?: string | null
          summary?: string | null
          title: string
          updated_at?: string
          website_url?: string | null
          youtube_url?: string | null
        }
        Update: {
          apple_url?: string | null
          category?: string | null
          country?: string | null
          created_at?: string
          deep_hydration_error?: string | null
          deep_hydration_status?: string
          deep_hydration_target?: number | null
          description?: string | null
          featured?: boolean
          featured_rank?: number | null
          hydrated_episode_count?: number
          id?: string
          image_url?: string | null
          is_sample?: boolean
          language?: string | null
          last_deep_hydrated_at?: string | null
          last_fetch_duplicate_count?: number
          last_fetch_error?: string | null
          last_fetch_new_count?: number
          last_fetched_at?: string | null
          manual_rank_boost?: number
          podiverzum_rank?: number
          rank_label?: string | null
          rank_reason?: Json
          rank_updated_at?: string | null
          rss_status?: string
          rss_url?: string | null
          slug?: string
          source?: string | null
          spotify_url?: string | null
          summary?: string | null
          title?: string
          updated_at?: string
          website_url?: string | null
          youtube_url?: string | null
        }
        Relationships: []
      }
      search_events: {
        Row: {
          created_at: string
          fallback_used: boolean
          id: string
          query: string
          result_count: number
          terms_count: number
          user_id: string | null
          viewport_width: number | null
        }
        Insert: {
          created_at?: string
          fallback_used?: boolean
          id?: string
          query: string
          result_count?: number
          terms_count?: number
          user_id?: string | null
          viewport_width?: number | null
        }
        Update: {
          created_at?: string
          fallback_used?: boolean
          id?: string
          query?: string
          result_count?: number
          terms_count?: number
          user_id?: string | null
          viewport_width?: number | null
        }
        Relationships: []
      }
      search_synonyms: {
        Row: {
          created_at: string
          id: string
          synonyms: string[]
          term: string
        }
        Insert: {
          created_at?: string
          id?: string
          synonyms?: string[]
          term: string
        }
        Update: {
          created_at?: string
          id?: string
          synonyms?: string[]
          term?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
