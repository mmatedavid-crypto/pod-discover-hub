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
      ai_enrichment_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          cost_usd: number | null
          created_at: string
          id: string
          input_hash: string
          input_tokens: number | null
          kind: string
          last_error: string | null
          locked_until: string | null
          model: string | null
          output_tokens: number | null
          priority: number
          result: Json | null
          started_at: string | null
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          id?: string
          input_hash: string
          input_tokens?: number | null
          kind: string
          last_error?: string | null
          locked_until?: string | null
          model?: string | null
          output_tokens?: number | null
          priority?: number
          result?: Json | null
          started_at?: string | null
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          id?: string
          input_hash?: string
          input_tokens?: number | null
          kind?: string
          last_error?: string | null
          locked_until?: string | null
          model?: string | null
          output_tokens?: number | null
          priority?: number
          result?: Json | null
          started_at?: string | null
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: []
      }
      ai_spend_daily: {
        Row: {
          by_kind: Json
          calls: number
          day: string
          spend_usd: number
          updated_at: string
        }
        Insert: {
          by_kind?: Json
          calls?: number
          day: string
          spend_usd?: number
          updated_at?: string
        }
        Update: {
          by_kind?: Json
          calls?: number
          day?: string
          spend_usd?: number
          updated_at?: string
        }
        Relationships: []
      }
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
          import_attempts: number
          import_error: string | null
          import_status: string | null
          imported_at: string | null
          imported_podcast_id: string | null
          language: string | null
          last_episode_at: string | null
          last_import_attempt_at: string | null
          next_import_attempt_at: string | null
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
          import_attempts?: number
          import_error?: string | null
          import_status?: string | null
          imported_at?: string | null
          imported_podcast_id?: string | null
          language?: string | null
          last_episode_at?: string | null
          last_import_attempt_at?: string | null
          next_import_attempt_at?: string | null
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
          import_attempts?: number
          import_error?: string | null
          import_status?: string | null
          imported_at?: string | null
          imported_podcast_id?: string | null
          language?: string | null
          last_episode_at?: string | null
          last_import_attempt_at?: string | null
          next_import_attempt_at?: string | null
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
      episode_embeddings: {
        Row: {
          content_hash: string
          embedding: string
          episode_id: string
          model: string
          podcast_id: string
          updated_at: string
        }
        Insert: {
          content_hash: string
          embedding: string
          episode_id: string
          model: string
          podcast_id: string
          updated_at?: string
        }
        Update: {
          content_hash?: string
          embedding?: string
          episode_id?: string
          model?: string
          podcast_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      episodes: {
        Row: {
          ai_enriched_at: string | null
          ai_entities_version: number
          ai_summary: string | null
          apple_url: string | null
          audio_url: string | null
          companies: string[] | null
          created_at: string
          description: string | null
          display_title: string | null
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
          seo_description: string | null
          seo_title: string | null
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
          ai_enriched_at?: string | null
          ai_entities_version?: number
          ai_summary?: string | null
          apple_url?: string | null
          audio_url?: string | null
          companies?: string[] | null
          created_at?: string
          description?: string | null
          display_title?: string | null
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
          seo_description?: string | null
          seo_title?: string | null
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
          ai_enriched_at?: string | null
          ai_entities_version?: number
          ai_summary?: string | null
          apple_url?: string | null
          audio_url?: string | null
          companies?: string[] | null
          created_at?: string
          description?: string | null
          display_title?: string | null
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
          seo_description?: string | null
          seo_title?: string | null
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
      page_events: {
        Row: {
          created_at: string
          full_url: string | null
          id: string
          path: string
          referrer: string | null
          user_id: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          viewport_width: number | null
        }
        Insert: {
          created_at?: string
          full_url?: string | null
          id?: string
          path: string
          referrer?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          viewport_width?: number | null
        }
        Update: {
          created_at?: string
          full_url?: string | null
          id?: string
          path?: string
          referrer?: string | null
          user_id?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          viewport_width?: number | null
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
          ai_active_signal: string | null
          ai_confidence: number | null
          ai_decision: string | null
          ai_detected_language: string | null
          ai_gated_at: string | null
          ai_input_hash: string | null
          ai_likely_category: string | null
          ai_model: string | null
          ai_quality_score: number | null
          ai_reasons: Json
          ai_spam_score: number | null
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
          next_process_attempt_at: string | null
          pi_id: number | null
          process_attempts: number
          processed: boolean
          processed_at: string | null
          reject_reason: string | null
          rss_url: string
          score: number | null
          title: string | null
          website_url: string | null
        }
        Insert: {
          ai_active_signal?: string | null
          ai_confidence?: number | null
          ai_decision?: string | null
          ai_detected_language?: string | null
          ai_gated_at?: string | null
          ai_input_hash?: string | null
          ai_likely_category?: string | null
          ai_model?: string | null
          ai_quality_score?: number | null
          ai_reasons?: Json
          ai_spam_score?: number | null
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
          next_process_attempt_at?: string | null
          pi_id?: number | null
          process_attempts?: number
          processed?: boolean
          processed_at?: string | null
          reject_reason?: string | null
          rss_url: string
          score?: number | null
          title?: string | null
          website_url?: string | null
        }
        Update: {
          ai_active_signal?: string | null
          ai_confidence?: number | null
          ai_decision?: string | null
          ai_detected_language?: string | null
          ai_gated_at?: string | null
          ai_input_hash?: string | null
          ai_likely_category?: string | null
          ai_model?: string | null
          ai_quality_score?: number | null
          ai_reasons?: Json
          ai_spam_score?: number | null
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
          next_process_attempt_at?: string | null
          pi_id?: number | null
          process_attempts?: number
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
      podcast_embeddings: {
        Row: {
          content_hash: string
          embedding: string
          model: string
          podcast_id: string
          updated_at: string
        }
        Insert: {
          content_hash: string
          embedding: string
          model: string
          podcast_id: string
          updated_at?: string
        }
        Update: {
          content_hash?: string
          embedding?: string
          model?: string
          podcast_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      podcasts: {
        Row: {
          ai_enriched_at: string | null
          ai_entities_version: number
          ai_quality_input_hash: string | null
          ai_quality_model: string | null
          ai_quality_reason: Json
          ai_quality_score: number | null
          ai_quality_updated_at: string | null
          ai_spam_score: number | null
          apple_url: string | null
          category: string | null
          consecutive_failure_count: number
          country: string | null
          crawl_priority: string | null
          crawl_state: string
          created_at: string
          deep_hydration_error: string | null
          deep_hydration_status: string
          deep_hydration_target: number | null
          description: string | null
          display_title: string | null
          featured: boolean
          featured_rank: number | null
          full_backfill_completed_at: string | null
          hydrated_episode_count: number
          id: string
          image_url: string | null
          is_sample: boolean
          language: string | null
          last_deep_hydrated_at: string | null
          last_etag: string | null
          last_fetch_duplicate_count: number
          last_fetch_error: string | null
          last_fetch_new_count: number
          last_fetched_at: string | null
          last_modified: string | null
          last_rss_hunt_at: string | null
          manual_rank_boost: number
          next_fetch_at: string | null
          next_rss_hunt_at: string | null
          podiverzum_rank: number
          quarantined_until: string | null
          rank_label: string | null
          rank_reason: Json
          rank_updated_at: string | null
          refresh_interval_minutes: number
          rss_hunt_attempts: number
          rss_status: string
          rss_url: string | null
          seo_description: string | null
          seo_title: string | null
          shadow_computed_at: string | null
          shadow_rank: number | null
          shadow_rank_components: Json
          shadow_rank_tier: string | null
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
          ai_enriched_at?: string | null
          ai_entities_version?: number
          ai_quality_input_hash?: string | null
          ai_quality_model?: string | null
          ai_quality_reason?: Json
          ai_quality_score?: number | null
          ai_quality_updated_at?: string | null
          ai_spam_score?: number | null
          apple_url?: string | null
          category?: string | null
          consecutive_failure_count?: number
          country?: string | null
          crawl_priority?: string | null
          crawl_state?: string
          created_at?: string
          deep_hydration_error?: string | null
          deep_hydration_status?: string
          deep_hydration_target?: number | null
          description?: string | null
          display_title?: string | null
          featured?: boolean
          featured_rank?: number | null
          full_backfill_completed_at?: string | null
          hydrated_episode_count?: number
          id?: string
          image_url?: string | null
          is_sample?: boolean
          language?: string | null
          last_deep_hydrated_at?: string | null
          last_etag?: string | null
          last_fetch_duplicate_count?: number
          last_fetch_error?: string | null
          last_fetch_new_count?: number
          last_fetched_at?: string | null
          last_modified?: string | null
          last_rss_hunt_at?: string | null
          manual_rank_boost?: number
          next_fetch_at?: string | null
          next_rss_hunt_at?: string | null
          podiverzum_rank?: number
          quarantined_until?: string | null
          rank_label?: string | null
          rank_reason?: Json
          rank_updated_at?: string | null
          refresh_interval_minutes?: number
          rss_hunt_attempts?: number
          rss_status?: string
          rss_url?: string | null
          seo_description?: string | null
          seo_title?: string | null
          shadow_computed_at?: string | null
          shadow_rank?: number | null
          shadow_rank_components?: Json
          shadow_rank_tier?: string | null
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
          ai_enriched_at?: string | null
          ai_entities_version?: number
          ai_quality_input_hash?: string | null
          ai_quality_model?: string | null
          ai_quality_reason?: Json
          ai_quality_score?: number | null
          ai_quality_updated_at?: string | null
          ai_spam_score?: number | null
          apple_url?: string | null
          category?: string | null
          consecutive_failure_count?: number
          country?: string | null
          crawl_priority?: string | null
          crawl_state?: string
          created_at?: string
          deep_hydration_error?: string | null
          deep_hydration_status?: string
          deep_hydration_target?: number | null
          description?: string | null
          display_title?: string | null
          featured?: boolean
          featured_rank?: number | null
          full_backfill_completed_at?: string | null
          hydrated_episode_count?: number
          id?: string
          image_url?: string | null
          is_sample?: boolean
          language?: string | null
          last_deep_hydrated_at?: string | null
          last_etag?: string | null
          last_fetch_duplicate_count?: number
          last_fetch_error?: string | null
          last_fetch_new_count?: number
          last_fetched_at?: string | null
          last_modified?: string | null
          last_rss_hunt_at?: string | null
          manual_rank_boost?: number
          next_fetch_at?: string | null
          next_rss_hunt_at?: string | null
          podiverzum_rank?: number
          quarantined_until?: string | null
          rank_label?: string | null
          rank_reason?: Json
          rank_updated_at?: string | null
          refresh_interval_minutes?: number
          rss_hunt_attempts?: number
          rss_status?: string
          rss_url?: string | null
          seo_description?: string | null
          seo_title?: string | null
          shadow_computed_at?: string | null
          shadow_rank?: number | null
          shadow_rank_components?: Json
          shadow_rank_tier?: string | null
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
      podcasts_backup_pre_c_v3: {
        Row: {
          backed_up_at: string | null
          id: string | null
          podiverzum_rank: number | null
          rank_label: string | null
          rank_reason: Json | null
          rank_updated_at: string | null
          refresh_interval_minutes: number | null
          shadow_rank: number | null
          shadow_rank_components: Json | null
          shadow_rank_tier: string | null
        }
        Insert: {
          backed_up_at?: string | null
          id?: string | null
          podiverzum_rank?: number | null
          rank_label?: string | null
          rank_reason?: Json | null
          rank_updated_at?: string | null
          refresh_interval_minutes?: number | null
          shadow_rank?: number | null
          shadow_rank_components?: Json | null
          shadow_rank_tier?: string | null
        }
        Update: {
          backed_up_at?: string | null
          id?: string | null
          podiverzum_rank?: number | null
          rank_label?: string | null
          rank_reason?: Json | null
          rank_updated_at?: string | null
          refresh_interval_minutes?: number | null
          shadow_rank?: number | null
          shadow_rank_components?: Json | null
          shadow_rank_tier?: string | null
        }
        Relationships: []
      }
      rss_url_history: {
        Row: {
          changed_at: string
          id: string
          new_url: string
          old_url: string | null
          podcast_id: string
          reason: string
        }
        Insert: {
          changed_at?: string
          id?: string
          new_url: string
          old_url?: string | null
          podcast_id: string
          reason: string
        }
        Update: {
          changed_at?: string
          id?: string
          new_url?: string
          old_url?: string | null
          podcast_id?: string
          reason?: string
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
      claim_ai_jobs: {
        Args: { _limit: number; _lock_seconds?: number }
        Returns: {
          attempts: number
          completed_at: string | null
          cost_usd: number | null
          created_at: string
          id: string
          input_hash: string
          input_tokens: number | null
          kind: string
          last_error: string | null
          locked_until: string | null
          model: string | null
          output_tokens: number | null
          priority: number
          result: Json | null
          started_at: string | null
          status: string
          target_id: string
          target_type: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ai_enrichment_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cron_revert_title_cleanup: { Args: never; Returns: undefined }
      embed_candidate_stats: {
        Args: { _model: string; _tiers: string[] }
        Returns: Json
      }
      formula_c_candidates: {
        Args: { _limit?: number }
        Returns: {
          id: string
        }[]
      }
      formula_c_status: { Args: never; Returns: Json }
      get_cron_health: { Args: never; Returns: Json }
      get_ops_dashboard_status: { Args: never; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      reap_ai_stale_locks: {
        Args: { _older_than_minutes?: number }
        Returns: number
      }
      reap_deep_hydration_stale: {
        Args: { _older_than_minutes?: number }
        Returns: number
      }
      select_embed_candidates: {
        Args: { _limit: number; _model: string; _tiers: string[] }
        Returns: {
          category: string
          description: string
          display_title: string
          id: string
          rank_label: string
          seo_description: string
          shadow_rank_components: Json
          title: string
        }[]
      }
      set_deep_hydration_schedule: {
        Args: { _schedule: string }
        Returns: undefined
      }
      set_embed_schedule: { Args: { _schedule: string }; Returns: undefined }
      set_incremental_refresh_command: {
        Args: { _command: string }
        Returns: undefined
      }
      set_incremental_refresh_schedule: {
        Args: { _schedule: string }
        Returns: undefined
      }
      set_rss_hunter_schedule: {
        Args: { _schedule: string }
        Returns: undefined
      }
      set_rss_self_healing_command: {
        Args: { _active?: boolean; _command: string; _schedule?: string }
        Returns: undefined
      }
      set_seo_enrich_runner_schedule: {
        Args: { _schedule: string }
        Returns: undefined
      }
      set_title_cleanup_schedule: {
        Args: { _schedule: string }
        Returns: undefined
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
