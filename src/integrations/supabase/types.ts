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
      ai_call_audit: {
        Row: {
          confidence: number | null
          created_at: string
          error_message: string | null
          estimated_cost_usd: number | null
          id: string
          input_tokens: number | null
          job_type: string
          key_source: string | null
          latency_ms: number | null
          meta: Json
          model_used: string
          output_tokens: number | null
          prompt_version: string | null
          provider: string
          source_hash: string | null
          status: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          error_message?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          job_type: string
          key_source?: string | null
          latency_ms?: number | null
          meta?: Json
          model_used: string
          output_tokens?: number | null
          prompt_version?: string | null
          provider?: string
          source_hash?: string | null
          status?: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          error_message?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          job_type?: string
          key_source?: string | null
          latency_ms?: number | null
          meta?: Json
          model_used?: string
          output_tokens?: number | null
          prompt_version?: string | null
          provider?: string
          source_hash?: string | null
          status?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
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
      ai_runs: {
        Row: {
          cost_usd: number
          created_at: string
          id: string
          meta: Json | null
          model: string | null
          runner: string
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          id?: string
          meta?: Json | null
          model?: string | null
          runner: string
        }
        Update: {
          cost_usd?: number
          created_at?: string
          id?: string
          meta?: Json | null
          model?: string | null
          runner?: string
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
      canonical_alias_backfill_log: {
        Row: {
          action: string
          canonical_name: string
          canonical_slug: string
          current_name: string
          current_slug: string | null
          entity_id: string
          entity_kind: string
          id: string
          note: string | null
          run_at: string
        }
        Insert: {
          action: string
          canonical_name: string
          canonical_slug: string
          current_name: string
          current_slug?: string | null
          entity_id: string
          entity_kind: string
          id?: string
          note?: string | null
          run_at?: string
        }
        Update: {
          action?: string
          canonical_name?: string
          canonical_slug?: string
          current_name?: string
          current_slug?: string | null
          entity_id?: string
          entity_kind?: string
          id?: string
          note?: string | null
          run_at?: string
        }
        Relationships: []
      }
      canonical_entity_aliases: {
        Row: {
          alias: string
          canonical_name: string
          canonical_slug: string
          created_at: string
          entity_kind: string
          id: string
          language: string
          normalized_alias: string
          notes: string | null
          source: string
          status: string
          updated_at: string
          weight: number
        }
        Insert: {
          alias: string
          canonical_name: string
          canonical_slug: string
          created_at?: string
          entity_kind: string
          id?: string
          language?: string
          normalized_alias: string
          notes?: string | null
          source?: string
          status?: string
          updated_at?: string
          weight?: number
        }
        Update: {
          alias?: string
          canonical_name?: string
          canonical_slug?: string
          created_at?: string
          entity_kind?: string
          id?: string
          language?: string
          normalized_alias?: string
          notes?: string | null
          source?: string
          status?: string
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      categories: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          min_evidence_score: number
          name: string
          negative_hints: string[]
          positive_hints: string[]
          seo_description: string | null
          seo_title: string | null
          seo_updated_at: string | null
          slug: string
          sort_order: number
          taxonomy_keys: string[]
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          min_evidence_score?: number
          name: string
          negative_hints?: string[]
          positive_hints?: string[]
          seo_description?: string | null
          seo_title?: string | null
          seo_updated_at?: string | null
          slug: string
          sort_order?: number
          taxonomy_keys?: string[]
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          min_evidence_score?: number
          name?: string
          negative_hints?: string[]
          positive_hints?: string[]
          seo_description?: string | null
          seo_title?: string | null
          seo_updated_at?: string | null
          slug?: string
          sort_order?: number
          taxonomy_keys?: string[]
        }
        Relationships: []
      }
      daily_brief_extras: {
        Row: {
          created_at: string
          date: string
          generated_at: string
          on_this_day: Json
          quote: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          generated_at?: string
          on_this_day?: Json
          quote?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          generated_at?: string
          on_this_day?: Json
          quote?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      daily_trend_episodes: {
        Row: {
          created_at: string
          episode_id: string
          id: string
          match_source: string | null
          rank: number
          score: number | null
          trend_id: string
        }
        Insert: {
          created_at?: string
          episode_id: string
          id?: string
          match_source?: string | null
          rank: number
          score?: number | null
          trend_id: string
        }
        Update: {
          created_at?: string
          episode_id?: string
          id?: string
          match_source?: string | null
          rank?: number
          score?: number | null
          trend_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_trend_episodes_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_trend_episodes_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "daily_trend_episodes_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "daily_trend_episodes_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_data_quality_issues"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "daily_trend_episodes_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_quality_indicator_audit"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "daily_trend_episodes_trend_id_fkey"
            columns: ["trend_id"]
            isOneToOne: false
            referencedRelation: "daily_trends"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_trends: {
        Row: {
          batch_id: string
          created_at: string
          fetched_at: string
          id: string
          is_active: boolean
          keyword: string
          normalized_keyword: string | null
          rank: number | null
          region: string
          related_queries: Json | null
          resolved_kind: string | null
          resolved_organization_id: string | null
          resolved_person_id: string | null
          source: string
          traffic: string | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          fetched_at?: string
          id?: string
          is_active?: boolean
          keyword: string
          normalized_keyword?: string | null
          rank?: number | null
          region?: string
          related_queries?: Json | null
          resolved_kind?: string | null
          resolved_organization_id?: string | null
          resolved_person_id?: string | null
          source?: string
          traffic?: string | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          fetched_at?: string
          id?: string
          is_active?: boolean
          keyword?: string
          normalized_keyword?: string | null
          rank?: number | null
          region?: string
          related_queries?: Json | null
          resolved_kind?: string | null
          resolved_organization_id?: string | null
          resolved_person_id?: string | null
          source?: string
          traffic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_trends_resolved_organization_id_fkey"
            columns: ["resolved_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_trends_resolved_person_id_fkey"
            columns: ["resolved_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_trends_resolved_person_id_fkey"
            columns: ["resolved_person_id"]
            isOneToOne: false
            referencedRelation: "person_activation_status_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_trends_resolved_person_id_fkey"
            columns: ["resolved_person_id"]
            isOneToOne: false
            referencedRelation: "person_ai_action_queue_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_trends_resolved_person_id_fkey"
            columns: ["resolved_person_id"]
            isOneToOne: false
            referencedRelation: "person_ai_duplicate_candidates_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_trends_resolved_person_id_fkey"
            columns: ["resolved_person_id"]
            isOneToOne: false
            referencedRelation: "person_missing_content_review_view"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "daily_trends_resolved_person_id_fkey"
            columns: ["resolved_person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_duplicate_clusters"
            referencedColumns: ["person_a_id"]
          },
          {
            foreignKeyName: "daily_trends_resolved_person_id_fkey"
            columns: ["resolved_person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_duplicate_clusters"
            referencedColumns: ["person_b_id"]
          },
          {
            foreignKeyName: "daily_trends_resolved_person_id_fkey"
            columns: ["resolved_person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_high_reject_ratio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_trends_resolved_person_id_fkey"
            columns: ["resolved_person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_pending_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_trends_resolved_person_id_fkey"
            columns: ["resolved_person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_surname_only_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_trends_resolved_person_id_fkey"
            columns: ["resolved_person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_weak_public_pages"
            referencedColumns: ["id"]
          },
        ]
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
      editorial_people_seed: {
        Row: {
          aliases: string[]
          canonical_name: string | null
          context_hints: string[]
          created_at: string
          evidence: Json
          id: string
          last_run_at: string | null
          matched_person_id: string | null
          name: string
          notes: string | null
          priority_level: number
          slug: string | null
          status: string
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          canonical_name?: string | null
          context_hints?: string[]
          created_at?: string
          evidence?: Json
          id?: string
          last_run_at?: string | null
          matched_person_id?: string | null
          name: string
          notes?: string | null
          priority_level?: number
          slug?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          canonical_name?: string | null
          context_hints?: string[]
          created_at?: string
          evidence?: Json
          id?: string
          last_run_at?: string | null
          matched_person_id?: string | null
          name?: string
          notes?: string | null
          priority_level?: number
          slug?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "editorial_people_seed_matched_person_id_fkey"
            columns: ["matched_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_people_seed_matched_person_id_fkey"
            columns: ["matched_person_id"]
            isOneToOne: false
            referencedRelation: "person_activation_status_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_people_seed_matched_person_id_fkey"
            columns: ["matched_person_id"]
            isOneToOne: false
            referencedRelation: "person_ai_action_queue_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_people_seed_matched_person_id_fkey"
            columns: ["matched_person_id"]
            isOneToOne: false
            referencedRelation: "person_ai_duplicate_candidates_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_people_seed_matched_person_id_fkey"
            columns: ["matched_person_id"]
            isOneToOne: false
            referencedRelation: "person_missing_content_review_view"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "editorial_people_seed_matched_person_id_fkey"
            columns: ["matched_person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_duplicate_clusters"
            referencedColumns: ["person_a_id"]
          },
          {
            foreignKeyName: "editorial_people_seed_matched_person_id_fkey"
            columns: ["matched_person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_duplicate_clusters"
            referencedColumns: ["person_b_id"]
          },
          {
            foreignKeyName: "editorial_people_seed_matched_person_id_fkey"
            columns: ["matched_person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_high_reject_ratio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_people_seed_matched_person_id_fkey"
            columns: ["matched_person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_pending_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_people_seed_matched_person_id_fkey"
            columns: ["matched_person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_surname_only_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_people_seed_matched_person_id_fkey"
            columns: ["matched_person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_weak_public_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_posts: {
        Row: {
          ai_model: string | null
          approved_at: string | null
          approved_by: string | null
          card_image_urls: Json | null
          cover_image_url: string | null
          created_at: string
          created_by: string | null
          fb_caption: string | null
          generation_meta: Json | null
          id: string
          ig_caption: string | null
          intro: string | null
          items: Json
          published_at: string | null
          status: string
          title: string | null
          trigger: string | null
          updated_at: string
          week_end: string
          week_start: string
        }
        Insert: {
          ai_model?: string | null
          approved_at?: string | null
          approved_by?: string | null
          card_image_urls?: Json | null
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          fb_caption?: string | null
          generation_meta?: Json | null
          id?: string
          ig_caption?: string | null
          intro?: string | null
          items?: Json
          published_at?: string | null
          status?: string
          title?: string | null
          trigger?: string | null
          updated_at?: string
          week_end: string
          week_start: string
        }
        Update: {
          ai_model?: string | null
          approved_at?: string | null
          approved_by?: string | null
          card_image_urls?: Json | null
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          fb_caption?: string | null
          generation_meta?: Json | null
          id?: string
          ig_caption?: string | null
          intro?: string | null
          items?: Json
          published_at?: string | null
          status?: string
          title?: string | null
          trigger?: string | null
          updated_at?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      entities: {
        Row: {
          created_at: string
          entity_type: string
          episode_count: number
          id: string
          is_indexable: boolean
          is_public: boolean
          metadata: Json
          name: string
          normalized_name: string
          slug: string
          updated_at: string
          wikidata_id: string | null
        }
        Insert: {
          created_at?: string
          entity_type: string
          episode_count?: number
          id?: string
          is_indexable?: boolean
          is_public?: boolean
          metadata?: Json
          name: string
          normalized_name: string
          slug: string
          updated_at?: string
          wikidata_id?: string | null
        }
        Update: {
          created_at?: string
          entity_type?: string
          episode_count?: number
          id?: string
          is_indexable?: boolean
          is_public?: boolean
          metadata?: Json
          name?: string
          normalized_name?: string
          slug?: string
          updated_at?: string
          wikidata_id?: string | null
        }
        Relationships: []
      }
      entity_extraction_runs: {
        Row: {
          created_person_count: number
          error_message: string | null
          extracted_person_count: number
          finished_at: string | null
          id: string
          run_type: string
          scanned_episode_count: number
          started_at: string
          status: string
          updated_person_count: number
        }
        Insert: {
          created_person_count?: number
          error_message?: string | null
          extracted_person_count?: number
          finished_at?: string | null
          id?: string
          run_type?: string
          scanned_episode_count?: number
          started_at?: string
          status?: string
          updated_person_count?: number
        }
        Update: {
          created_person_count?: number
          error_message?: string | null
          extracted_person_count?: number
          finished_at?: string | null
          id?: string
          run_type?: string
          scanned_episode_count?: number
          started_at?: string
          status?: string
          updated_person_count?: number
        }
        Relationships: []
      }
      entity_profiles: {
        Row: {
          appearance_stats: Json
          bio: string | null
          cost_usd: number | null
          display_name: string
          episode_ids: string[]
          episodes_summary: string | null
          featured_episode_ids: string[]
          generated_at: string
          kind: string
          model: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          appearance_stats?: Json
          bio?: string | null
          cost_usd?: number | null
          display_name: string
          episode_ids?: string[]
          episodes_summary?: string | null
          featured_episode_ids?: string[]
          generated_at?: string
          kind: string
          model?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          appearance_stats?: Json
          bio?: string | null
          cost_usd?: number | null
          display_name?: string
          episode_ids?: string[]
          episodes_summary?: string | null
          featured_episode_ids?: string[]
          generated_at?: string
          kind?: string
          model?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      episode_ai_classifications: {
        Row: {
          classification_status: string
          confidence: number
          created_at: string
          episode_id: string
          false_positive_risks: string[]
          id: string
          model_version: string | null
          primary_category: string | null
          reason_hu: string | null
          rejected_topics: Json
          reviewed_by: string
          secondary_categories: Json
          source_hash: string
          taxonomy_version: string
          topics: Json
          updated_at: string
          vector_evidence: Json
        }
        Insert: {
          classification_status?: string
          confidence?: number
          created_at?: string
          episode_id: string
          false_positive_risks?: string[]
          id?: string
          model_version?: string | null
          primary_category?: string | null
          reason_hu?: string | null
          rejected_topics?: Json
          reviewed_by?: string
          secondary_categories?: Json
          source_hash: string
          taxonomy_version?: string
          topics?: Json
          updated_at?: string
          vector_evidence?: Json
        }
        Update: {
          classification_status?: string
          confidence?: number
          created_at?: string
          episode_id?: string
          false_positive_risks?: string[]
          id?: string
          model_version?: string | null
          primary_category?: string | null
          reason_hu?: string | null
          rejected_topics?: Json
          reviewed_by?: string
          secondary_categories?: Json
          source_hash?: string
          taxonomy_version?: string
          topics?: Json
          updated_at?: string
          vector_evidence?: Json
        }
        Relationships: [
          {
            foreignKeyName: "eac_episode_fk"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eac_episode_fk"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "eac_episode_fk"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "eac_episode_fk"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_data_quality_issues"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "eac_episode_fk"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_quality_indicator_audit"
            referencedColumns: ["episode_id"]
          },
        ]
      }
      episode_article_candidates: {
        Row: {
          article_excerpt: string | null
          article_published_at: string | null
          article_text: string | null
          article_title: string
          article_url: string
          created_at: string
          episode_id: string
          evidence: Json
          fetched_at: string
          id: string
          match_reasons: string[]
          match_score: number
          outlet: string
          podcast_id: string
          reviewed_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          article_excerpt?: string | null
          article_published_at?: string | null
          article_text?: string | null
          article_title: string
          article_url: string
          created_at?: string
          episode_id: string
          evidence?: Json
          fetched_at?: string
          id?: string
          match_reasons?: string[]
          match_score?: number
          outlet: string
          podcast_id: string
          reviewed_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          article_excerpt?: string | null
          article_published_at?: string | null
          article_text?: string | null
          article_title?: string
          article_url?: string
          created_at?: string
          episode_id?: string
          evidence?: Json
          fetched_at?: string
          id?: string
          match_reasons?: string[]
          match_score?: number
          outlet?: string
          podcast_id?: string
          reviewed_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "episode_article_candidates_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episode_article_candidates_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_article_candidates_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_article_candidates_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_data_quality_issues"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_article_candidates_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_quality_indicator_audit"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_article_candidates_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "episode_article_candidates_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "episode_article_candidates_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episode_article_candidates_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_hu_archive_completeness"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "episode_article_candidates_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_youtube_native_transcript_candidates"
            referencedColumns: ["podcast_id"]
          },
        ]
      }
      episode_best_text_source: {
        Row: {
          cleaned_len: number
          cleaned_preview: string | null
          episode_id: string
          evidence: Json
          podcast_id: string
          raw_len: number
          raw_text: string
          selected_at: string
          source_confidence: number
          source_reason: string[]
          source_ref_id: string | null
          source_type: string
          updated_at: string
        }
        Insert: {
          cleaned_len?: number
          cleaned_preview?: string | null
          episode_id: string
          evidence?: Json
          podcast_id: string
          raw_len?: number
          raw_text: string
          selected_at?: string
          source_confidence?: number
          source_reason?: string[]
          source_ref_id?: string | null
          source_type: string
          updated_at?: string
        }
        Update: {
          cleaned_len?: number
          cleaned_preview?: string | null
          episode_id?: string
          evidence?: Json
          podcast_id?: string
          raw_len?: number
          raw_text?: string
          selected_at?: string
          source_confidence?: number
          source_reason?: string[]
          source_ref_id?: string | null
          source_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "episode_best_text_source_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: true
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episode_best_text_source_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: true
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_best_text_source_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: true
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_best_text_source_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: true
            referencedRelation: "v_episode_data_quality_issues"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_best_text_source_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: true
            referencedRelation: "v_episode_quality_indicator_audit"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_best_text_source_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "episode_best_text_source_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "episode_best_text_source_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episode_best_text_source_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_hu_archive_completeness"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "episode_best_text_source_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_youtube_native_transcript_candidates"
            referencedColumns: ["podcast_id"]
          },
        ]
      }
      episode_category_overrides: {
        Row: {
          category_slug: string
          confidence: number
          created_at: string
          episode_id: string
          id: string
          model_version: string | null
          reason_hu: string | null
          reviewed_at: string | null
          reviewed_by: string
          source_hash: string
          status: string
        }
        Insert: {
          category_slug: string
          confidence?: number
          created_at?: string
          episode_id: string
          id?: string
          model_version?: string | null
          reason_hu?: string | null
          reviewed_at?: string | null
          reviewed_by?: string
          source_hash: string
          status?: string
        }
        Update: {
          category_slug?: string
          confidence?: number
          created_at?: string
          episode_id?: string
          id?: string
          model_version?: string | null
          reason_hu?: string | null
          reviewed_at?: string | null
          reviewed_by?: string
          source_hash?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "eco_category_fk"
            columns: ["category_slug"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "eco_episode_fk"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eco_episode_fk"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "eco_episode_fk"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "eco_episode_fk"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_data_quality_issues"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "eco_episode_fk"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_quality_indicator_audit"
            referencedColumns: ["episode_id"]
          },
        ]
      }
      episode_chapters: {
        Row: {
          episode_id: string
          generated_at: string
          id: string
          idx: number
          start_sec: number
          summary: string | null
          title: string
        }
        Insert: {
          episode_id: string
          generated_at?: string
          id?: string
          idx: number
          start_sec: number
          summary?: string | null
          title: string
        }
        Update: {
          episode_id?: string
          generated_at?: string
          id?: string
          idx?: number
          start_sec?: number
          summary?: string | null
          title?: string
        }
        Relationships: []
      }
      episode_chunks: {
        Row: {
          char_end: number
          char_start: number
          chunk_count: number
          chunk_idx: number
          chunking_method: string
          content: string
          content_hash: string
          embedding: string
          episode_id: string
          model: string
          podcast_id: string
          segment_end_idx: number | null
          segment_start_idx: number | null
          source_transcript_model: string | null
          timestamp_end_seconds: number | null
          timestamp_start_seconds: number | null
          updated_at: string
        }
        Insert: {
          char_end?: number
          char_start?: number
          chunk_count: number
          chunk_idx: number
          chunking_method?: string
          content: string
          content_hash: string
          embedding: string
          episode_id: string
          model: string
          podcast_id: string
          segment_end_idx?: number | null
          segment_start_idx?: number | null
          source_transcript_model?: string | null
          timestamp_end_seconds?: number | null
          timestamp_start_seconds?: number | null
          updated_at?: string
        }
        Update: {
          char_end?: number
          char_start?: number
          chunk_count?: number
          chunk_idx?: number
          chunking_method?: string
          content?: string
          content_hash?: string
          embedding?: string
          episode_id?: string
          model?: string
          podcast_id?: string
          segment_end_idx?: number | null
          segment_start_idx?: number | null
          source_transcript_model?: string | null
          timestamp_end_seconds?: number | null
          timestamp_start_seconds?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      episode_clean_text: {
        Row: {
          cleaned_text: string
          cleaner_method: string
          cost_usd: number | null
          created_at: string
          episode_id: string
          model: string | null
          removed_categories: string[]
          source_hash: string
          updated_at: string
        }
        Insert: {
          cleaned_text: string
          cleaner_method: string
          cost_usd?: number | null
          created_at?: string
          episode_id: string
          model?: string | null
          removed_categories?: string[]
          source_hash: string
          updated_at?: string
        }
        Update: {
          cleaned_text?: string
          cleaner_method?: string
          cost_usd?: number | null
          created_at?: string
          episode_id?: string
          model?: string | null
          removed_categories?: string[]
          source_hash?: string
          updated_at?: string
        }
        Relationships: []
      }
      episode_clean_text_candidates: {
        Row: {
          cleaned_text: string
          cleaner_method: string
          created_at: string
          episode_id: string
          promoted_at: string | null
          quality_reasons: string[]
          quality_score: number | null
          quality_status: string
          removed_categories: string[]
          source_hash: string
          updated_at: string
        }
        Insert: {
          cleaned_text: string
          cleaner_method: string
          created_at?: string
          episode_id: string
          promoted_at?: string | null
          quality_reasons?: string[]
          quality_score?: number | null
          quality_status?: string
          removed_categories?: string[]
          source_hash: string
          updated_at?: string
        }
        Update: {
          cleaned_text?: string
          cleaner_method?: string
          created_at?: string
          episode_id?: string
          promoted_at?: string | null
          quality_reasons?: string[]
          quality_score?: number | null
          quality_status?: string
          removed_categories?: string[]
          source_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "episode_clean_text_candidates_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episode_clean_text_candidates_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_clean_text_candidates_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_clean_text_candidates_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_data_quality_issues"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_clean_text_candidates_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_quality_indicator_audit"
            referencedColumns: ["episode_id"]
          },
        ]
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
      episode_extracted_topics: {
        Row: {
          confidence: number | null
          created_at: string
          episode_id: string
          extractor_version: number
          id: string
          kind: string | null
          model: string
          normalized_label: string
          rationale: string | null
          raw_label: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          episode_id: string
          extractor_version?: number
          id?: string
          kind?: string | null
          model: string
          normalized_label: string
          rationale?: string | null
          raw_label: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          episode_id?: string
          extractor_version?: number
          id?: string
          kind?: string | null
          model?: string
          normalized_label?: string
          rationale?: string | null
          raw_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "episode_extracted_topics_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episode_extracted_topics_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_extracted_topics_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_extracted_topics_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_data_quality_issues"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_extracted_topics_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_quality_indicator_audit"
            referencedColumns: ["episode_id"]
          },
        ]
      }
      episode_organization_map: {
        Row: {
          confidence: number
          created_at: string
          episode_id: string
          id: string
          organization_id: string
          podcast_id: string | null
          role: string
          source: string
          source_evidence: Json
        }
        Insert: {
          confidence?: number
          created_at?: string
          episode_id: string
          id?: string
          organization_id: string
          podcast_id?: string | null
          role?: string
          source?: string
          source_evidence?: Json
        }
        Update: {
          confidence?: number
          created_at?: string
          episode_id?: string
          id?: string
          organization_id?: string
          podcast_id?: string | null
          role?: string
          source?: string
          source_evidence?: Json
        }
        Relationships: [
          {
            foreignKeyName: "episode_organization_map_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      episode_spotify_meta: {
        Row: {
          audio_preview_url: string | null
          created_at: string
          duration_ms: number | null
          episode_id: string
          id: string
          is_playable: boolean | null
          last_synced_at: string
          match_confidence: number | null
          match_method: string | null
          podcast_id: string
          raw: Json | null
          release_date: string | null
          release_date_precision: string | null
          restrictions: Json | null
          spotify_description: string | null
          spotify_episode_id: string
          spotify_explicit: boolean | null
          spotify_html_description: string | null
          spotify_image_url_300: string | null
          spotify_image_url_64: string | null
          spotify_image_url_640: string | null
          spotify_language: string | null
          spotify_languages: string[] | null
          spotify_url: string | null
          updated_at: string
        }
        Insert: {
          audio_preview_url?: string | null
          created_at?: string
          duration_ms?: number | null
          episode_id: string
          id?: string
          is_playable?: boolean | null
          last_synced_at?: string
          match_confidence?: number | null
          match_method?: string | null
          podcast_id: string
          raw?: Json | null
          release_date?: string | null
          release_date_precision?: string | null
          restrictions?: Json | null
          spotify_description?: string | null
          spotify_episode_id: string
          spotify_explicit?: boolean | null
          spotify_html_description?: string | null
          spotify_image_url_300?: string | null
          spotify_image_url_64?: string | null
          spotify_image_url_640?: string | null
          spotify_language?: string | null
          spotify_languages?: string[] | null
          spotify_url?: string | null
          updated_at?: string
        }
        Update: {
          audio_preview_url?: string | null
          created_at?: string
          duration_ms?: number | null
          episode_id?: string
          id?: string
          is_playable?: boolean | null
          last_synced_at?: string
          match_confidence?: number | null
          match_method?: string | null
          podcast_id?: string
          raw?: Json | null
          release_date?: string | null
          release_date_precision?: string | null
          restrictions?: Json | null
          spotify_description?: string | null
          spotify_episode_id?: string
          spotify_explicit?: boolean | null
          spotify_html_description?: string | null
          spotify_image_url_300?: string | null
          spotify_image_url_64?: string | null
          spotify_image_url_640?: string | null
          spotify_language?: string | null
          spotify_languages?: string[] | null
          spotify_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      episode_topic_cluster_map: {
        Row: {
          cluster_id: string
          confidence: number
          created_at: string
          episode_id: string
          source_label: string | null
        }
        Insert: {
          cluster_id: string
          confidence?: number
          created_at?: string
          episode_id: string
          source_label?: string | null
        }
        Update: {
          cluster_id?: string
          confidence?: number
          created_at?: string
          episode_id?: string
          source_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "episode_topic_cluster_map_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "topic_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episode_topic_cluster_map_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episode_topic_cluster_map_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_topic_cluster_map_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_topic_cluster_map_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_data_quality_issues"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_topic_cluster_map_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_quality_indicator_audit"
            referencedColumns: ["episode_id"]
          },
        ]
      }
      episode_topic_map: {
        Row: {
          confidence: number
          created_at: string
          episode_id: string
          source: string | null
          topic_id: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          episode_id: string
          source?: string | null
          topic_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          episode_id?: string
          source?: string | null
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "episode_topic_map_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episode_topic_map_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_topic_map_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_topic_map_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_data_quality_issues"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_topic_map_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_quality_indicator_audit"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "episode_topic_map_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episode_topic_map_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "v_canonical_topic_aliases"
            referencedColumns: ["topic_id"]
          },
        ]
      }
      episode_topic_relevance_reviews: {
        Row: {
          candidate_source: string
          confidence: number
          created_at: string
          episode_id: string
          id: string
          model_version: string | null
          reason_hu: string | null
          reviewed_at: string | null
          reviewed_by: string
          source_hash: string
          status: string
          suggested_topic_ids: string[]
          topic_id: string
        }
        Insert: {
          candidate_source: string
          confidence?: number
          created_at?: string
          episode_id: string
          id?: string
          model_version?: string | null
          reason_hu?: string | null
          reviewed_at?: string | null
          reviewed_by?: string
          source_hash: string
          status?: string
          suggested_topic_ids?: string[]
          topic_id: string
        }
        Update: {
          candidate_source?: string
          confidence?: number
          created_at?: string
          episode_id?: string
          id?: string
          model_version?: string | null
          reason_hu?: string | null
          reviewed_at?: string | null
          reviewed_by?: string
          source_hash?: string
          status?: string
          suggested_topic_ids?: string[]
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "etrr_episode_fk"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "etrr_episode_fk"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "etrr_episode_fk"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "etrr_episode_fk"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_data_quality_issues"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "etrr_episode_fk"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_quality_indicator_audit"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "etrr_topic_fk"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "etrr_topic_fk"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "v_canonical_topic_aliases"
            referencedColumns: ["topic_id"]
          },
        ]
      }
      episode_transcripts: {
        Row: {
          audio_bytes: number | null
          content_hash: string | null
          cost_usd: number | null
          created_at: string
          duration_seconds: number | null
          episode_id: string
          error_reason: string | null
          id: string
          input_tokens: number | null
          language: string | null
          latency_ms: number | null
          model: string
          output_tokens: number | null
          podcast_id: string
          public_display: boolean
          rights_status: string
          segments: Json | null
          source: string | null
          status: string
          transcript: string
          updated_at: string
        }
        Insert: {
          audio_bytes?: number | null
          content_hash?: string | null
          cost_usd?: number | null
          created_at?: string
          duration_seconds?: number | null
          episode_id: string
          error_reason?: string | null
          id?: string
          input_tokens?: number | null
          language?: string | null
          latency_ms?: number | null
          model: string
          output_tokens?: number | null
          podcast_id: string
          public_display?: boolean
          rights_status?: string
          segments?: Json | null
          source?: string | null
          status?: string
          transcript: string
          updated_at?: string
        }
        Update: {
          audio_bytes?: number | null
          content_hash?: string | null
          cost_usd?: number | null
          created_at?: string
          duration_seconds?: number | null
          episode_id?: string
          error_reason?: string | null
          id?: string
          input_tokens?: number | null
          language?: string | null
          latency_ms?: number | null
          model?: string
          output_tokens?: number | null
          podcast_id?: string
          public_display?: boolean
          rights_status?: string
          segments?: Json | null
          source?: string | null
          status?: string
          transcript?: string
          updated_at?: string
        }
        Relationships: []
      }
      episode_youtube_links: {
        Row: {
          confidence: string
          created_at: string
          episode_id: string
          found_by: string | null
          id: string
          match_score: number | null
          podcast_id: string
          status: string
          updated_at: string
          validated_by: string | null
          validation_reason: Json
          youtube_caption_available: boolean | null
          youtube_caption_checked_at: string | null
          youtube_channel_id: string | null
          youtube_description: string | null
          youtube_duration_seconds: number | null
          youtube_published_at: string | null
          youtube_title: string | null
          youtube_video_id: string
          youtube_view_count: number | null
        }
        Insert: {
          confidence?: string
          created_at?: string
          episode_id: string
          found_by?: string | null
          id?: string
          match_score?: number | null
          podcast_id: string
          status?: string
          updated_at?: string
          validated_by?: string | null
          validation_reason?: Json
          youtube_caption_available?: boolean | null
          youtube_caption_checked_at?: string | null
          youtube_channel_id?: string | null
          youtube_description?: string | null
          youtube_duration_seconds?: number | null
          youtube_published_at?: string | null
          youtube_title?: string | null
          youtube_video_id: string
          youtube_view_count?: number | null
        }
        Update: {
          confidence?: string
          created_at?: string
          episode_id?: string
          found_by?: string | null
          id?: string
          match_score?: number | null
          podcast_id?: string
          status?: string
          updated_at?: string
          validated_by?: string | null
          validation_reason?: Json
          youtube_caption_available?: boolean | null
          youtube_caption_checked_at?: string | null
          youtube_channel_id?: string | null
          youtube_description?: string | null
          youtube_duration_seconds?: number | null
          youtube_published_at?: string | null
          youtube_title?: string | null
          youtube_video_id?: string
          youtube_view_count?: number | null
        }
        Relationships: []
      }
      episodes: {
        Row: {
          ai_enrich_input_hash: string | null
          ai_enrich_prompt_version: string | null
          ai_enriched_at: string | null
          ai_entities_version: number
          ai_summary: string | null
          ai_summary_source: string | null
          apple_url: string | null
          audio_probe_attempted_at: string | null
          audio_url: string | null
          clean_text_status: string
          companies: string[] | null
          created_at: string
          description: string | null
          detected_language: string | null
          display_title: string | null
          duration_seconds: number | null
          entity_extraction_evidence: Json
          episode_rank: number
          episode_rank_label: string | null
          episode_rank_reason: Json
          episode_rank_updated_at: string | null
          episode_url: string | null
          foreign_score: number | null
          guid: string | null
          hungarian_score: number | null
          id: string
          image_url: string | null
          ingredients: string[] | null
          institutions: string[]
          language_checked_at: string | null
          language_evidence: Json
          media_outlets: string[]
          mentioned: string[]
          organizations: Json
          parties: string[]
          people: string[] | null
          podcast_id: string
          published_at: string | null
          search_text: string | null
          search_tsv: unknown
          seo_description: string | null
          seo_title: string | null
          slug: string
          spotify_url: string | null
          summary: string | null
          tickers: string[] | null
          title: string
          topic_extracted_at: string | null
          topic_extraction_status: string
          topic_extraction_version: number
          topics: string[] | null
          updated_at: string
          youtube_match_score: number | null
          youtube_paired_at: string | null
          youtube_pairing_status: string
          youtube_url: string | null
          youtube_video_id: string | null
        }
        Insert: {
          ai_enrich_input_hash?: string | null
          ai_enrich_prompt_version?: string | null
          ai_enriched_at?: string | null
          ai_entities_version?: number
          ai_summary?: string | null
          ai_summary_source?: string | null
          apple_url?: string | null
          audio_probe_attempted_at?: string | null
          audio_url?: string | null
          clean_text_status?: string
          companies?: string[] | null
          created_at?: string
          description?: string | null
          detected_language?: string | null
          display_title?: string | null
          duration_seconds?: number | null
          entity_extraction_evidence?: Json
          episode_rank?: number
          episode_rank_label?: string | null
          episode_rank_reason?: Json
          episode_rank_updated_at?: string | null
          episode_url?: string | null
          foreign_score?: number | null
          guid?: string | null
          hungarian_score?: number | null
          id?: string
          image_url?: string | null
          ingredients?: string[] | null
          institutions?: string[]
          language_checked_at?: string | null
          language_evidence?: Json
          media_outlets?: string[]
          mentioned?: string[]
          organizations?: Json
          parties?: string[]
          people?: string[] | null
          podcast_id: string
          published_at?: string | null
          search_text?: string | null
          search_tsv?: unknown
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          spotify_url?: string | null
          summary?: string | null
          tickers?: string[] | null
          title: string
          topic_extracted_at?: string | null
          topic_extraction_status?: string
          topic_extraction_version?: number
          topics?: string[] | null
          updated_at?: string
          youtube_match_score?: number | null
          youtube_paired_at?: string | null
          youtube_pairing_status?: string
          youtube_url?: string | null
          youtube_video_id?: string | null
        }
        Update: {
          ai_enrich_input_hash?: string | null
          ai_enrich_prompt_version?: string | null
          ai_enriched_at?: string | null
          ai_entities_version?: number
          ai_summary?: string | null
          ai_summary_source?: string | null
          apple_url?: string | null
          audio_probe_attempted_at?: string | null
          audio_url?: string | null
          clean_text_status?: string
          companies?: string[] | null
          created_at?: string
          description?: string | null
          detected_language?: string | null
          display_title?: string | null
          duration_seconds?: number | null
          entity_extraction_evidence?: Json
          episode_rank?: number
          episode_rank_label?: string | null
          episode_rank_reason?: Json
          episode_rank_updated_at?: string | null
          episode_url?: string | null
          foreign_score?: number | null
          guid?: string | null
          hungarian_score?: number | null
          id?: string
          image_url?: string | null
          ingredients?: string[] | null
          institutions?: string[]
          language_checked_at?: string | null
          language_evidence?: Json
          media_outlets?: string[]
          mentioned?: string[]
          organizations?: Json
          parties?: string[]
          people?: string[] | null
          podcast_id?: string
          published_at?: string | null
          search_text?: string | null
          search_tsv?: unknown
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          spotify_url?: string | null
          summary?: string | null
          tickers?: string[] | null
          title?: string
          topic_extracted_at?: string | null
          topic_extraction_status?: string
          topic_extraction_version?: number
          topics?: string[] | null
          updated_at?: string
          youtube_match_score?: number | null
          youtube_paired_at?: string | null
          youtube_pairing_status?: string
          youtube_url?: string | null
          youtube_video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "episodes_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "episodes_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "episodes_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episodes_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_hu_archive_completeness"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "episodes_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_youtube_native_transcript_candidates"
            referencedColumns: ["podcast_id"]
          },
        ]
      }
      external_transcript_audit: {
        Row: {
          audio_bytes: number | null
          cost_usd: number | null
          created_at: string
          duration_seconds: number | null
          episode_id: string | null
          error_reason: string | null
          id: string
          latency_ms: number | null
          model: string | null
          source: string
          status: string
          worker_id: string | null
        }
        Insert: {
          audio_bytes?: number | null
          cost_usd?: number | null
          created_at?: string
          duration_seconds?: number | null
          episode_id?: string | null
          error_reason?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          source: string
          status: string
          worker_id?: string | null
        }
        Update: {
          audio_bytes?: number | null
          cost_usd?: number | null
          created_at?: string
          duration_seconds?: number | null
          episode_id?: string | null
          error_reason?: string | null
          id?: string
          latency_ms?: number | null
          model?: string | null
          source?: string
          status?: string
          worker_id?: string | null
        }
        Relationships: []
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
      gsc_query_daily: {
        Row: {
          clicks: number
          ctr: number
          date: string
          fetched_at: string
          id: number
          impressions: number
          page: string
          position: number
          query: string
          site_url: string
        }
        Insert: {
          clicks?: number
          ctr?: number
          date: string
          fetched_at?: string
          id?: number
          impressions?: number
          page: string
          position?: number
          query: string
          site_url: string
        }
        Update: {
          clicks?: number
          ctr?: number
          date?: string
          fetched_at?: string
          id?: number
          impressions?: number
          page?: string
          position?: number
          query?: string
          site_url?: string
        }
        Relationships: []
      }
      gsc_weekly_insights: {
        Row: {
          ai_model: string | null
          ai_recommendations: Json
          ai_summary: string | null
          created_at: string
          deltas: Json
          falling_queries: Json
          id: string
          raw_meta: Json
          rising_queries: Json
          site_url: string
          striking_distance: Json
          top_pages: Json
          top_queries: Json
          totals: Json
          week_end: string
          week_start: string
          zero_click_high_impr: Json
        }
        Insert: {
          ai_model?: string | null
          ai_recommendations?: Json
          ai_summary?: string | null
          created_at?: string
          deltas?: Json
          falling_queries?: Json
          id?: string
          raw_meta?: Json
          rising_queries?: Json
          site_url: string
          striking_distance?: Json
          top_pages?: Json
          top_queries?: Json
          totals?: Json
          week_end: string
          week_start: string
          zero_click_high_impr?: Json
        }
        Update: {
          ai_model?: string | null
          ai_recommendations?: Json
          ai_summary?: string | null
          created_at?: string
          deltas?: Json
          falling_queries?: Json
          id?: string
          raw_meta?: Json
          rising_queries?: Json
          site_url?: string
          striking_distance?: Json
          top_pages?: Json
          top_queries?: Json
          totals?: Json
          week_end?: string
          week_start?: string
          zero_click_high_impr?: Json
        }
        Relationships: []
      }
      hu_archive_backfill_runs: {
        Row: {
          ai_backlog_after: number | null
          ai_backlog_before: number | null
          created_at: string
          details: Json
          duplicates_skipped: number
          embedding_backlog_after: number | null
          embedding_backlog_before: number | null
          error_message: string | null
          failed_feeds: number
          finished_at: string | null
          id: string
          new_episodes_inserted: number
          podcasts_processed: number
          runtime_ms: number | null
          skipped_reason: string | null
          started_at: string
          status: string
          throttled: boolean
          tier_filter: string[]
          trigger_source: string
        }
        Insert: {
          ai_backlog_after?: number | null
          ai_backlog_before?: number | null
          created_at?: string
          details?: Json
          duplicates_skipped?: number
          embedding_backlog_after?: number | null
          embedding_backlog_before?: number | null
          error_message?: string | null
          failed_feeds?: number
          finished_at?: string | null
          id?: string
          new_episodes_inserted?: number
          podcasts_processed?: number
          runtime_ms?: number | null
          skipped_reason?: string | null
          started_at?: string
          status?: string
          throttled?: boolean
          tier_filter?: string[]
          trigger_source?: string
        }
        Update: {
          ai_backlog_after?: number | null
          ai_backlog_before?: number | null
          created_at?: string
          details?: Json
          duplicates_skipped?: number
          embedding_backlog_after?: number | null
          embedding_backlog_before?: number | null
          error_message?: string | null
          failed_feeds?: number
          finished_at?: string | null
          id?: string
          new_episodes_inserted?: number
          podcasts_processed?: number
          runtime_ms?: number | null
          skipped_reason?: string | null
          started_at?: string
          status?: string
          throttled?: boolean
          tier_filter?: string[]
          trigger_source?: string
        }
        Relationships: []
      }
      hu_v1_cutover_backup_20260529: {
        Row: {
          backup_at: string
          old_podiverzum_rank: number | null
          old_rank_label: string | null
          old_rank_reason: Json | null
          old_rank_updated_at: string | null
          old_shadow_components: Json | null
          podcast_id: string
        }
        Insert: {
          backup_at?: string
          old_podiverzum_rank?: number | null
          old_rank_label?: string | null
          old_rank_reason?: Json | null
          old_rank_updated_at?: string | null
          old_shadow_components?: Json | null
          podcast_id: string
        }
        Update: {
          backup_at?: string
          old_podiverzum_rank?: number | null
          old_rank_label?: string | null
          old_rank_reason?: Json | null
          old_rank_updated_at?: string | null
          old_shadow_components?: Json | null
          podcast_id?: string
        }
        Relationships: []
      }
      import_rank_public_quality_guard_20260530: {
        Row: {
          backup_at: string
          guard_reason: string
          old_podiverzum_rank: number | null
          old_rank_label: string | null
          old_rank_reason: Json | null
          old_shadow_rank: number | null
          old_shadow_rank_components: Json | null
          old_shadow_rank_tier: string | null
          podcast_id: string
        }
        Insert: {
          backup_at?: string
          guard_reason: string
          old_podiverzum_rank?: number | null
          old_rank_label?: string | null
          old_rank_reason?: Json | null
          old_shadow_rank?: number | null
          old_shadow_rank_components?: Json | null
          old_shadow_rank_tier?: string | null
          podcast_id: string
        }
        Update: {
          backup_at?: string
          guard_reason?: string
          old_podiverzum_rank?: number | null
          old_rank_label?: string | null
          old_rank_reason?: Json | null
          old_shadow_rank?: number | null
          old_shadow_rank_components?: Json | null
          old_shadow_rank_tier?: string | null
          podcast_id?: string
        }
        Relationships: []
      }
      landing_email_signups: {
        Row: {
          anonymous_session_id: string | null
          archetype_slug: string | null
          confirmed: boolean
          created_at: string
          email: string
          id: string
          source: string
          unsubscribed_at: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          anonymous_session_id?: string | null
          archetype_slug?: string | null
          confirmed?: boolean
          created_at?: string
          email: string
          id?: string
          source?: string
          unsubscribed_at?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          anonymous_session_id?: string | null
          archetype_slug?: string | null
          confirmed?: boolean
          created_at?: string
          email?: string
          id?: string
          source?: string
          unsubscribed_at?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: []
      }
      landing_events: {
        Row: {
          anonymous_session_id: string
          created_at: string
          device_type: string | null
          event_name: string
          id: string
          landing_variant: string | null
          meta: Json
          path: string | null
          referrer_domain: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          anonymous_session_id: string
          created_at?: string
          device_type?: string | null
          event_name: string
          id?: string
          landing_variant?: string | null
          meta?: Json
          path?: string | null
          referrer_domain?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          anonymous_session_id?: string
          created_at?: string
          device_type?: string | null
          event_name?: string
          id?: string
          landing_variant?: string | null
          meta?: Json
          path?: string | null
          referrer_domain?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: []
      }
      legacy_public_rank_replacement_20260530: {
        Row: {
          podcast_id: string
          previous_podiverzum_rank: number | null
          previous_rank_label: string | null
          previous_rank_reason: Json | null
          previous_shadow_rank: number | null
          previous_shadow_rank_tier: string | null
          replaced_at: string
          title: string | null
        }
        Insert: {
          podcast_id: string
          previous_podiverzum_rank?: number | null
          previous_rank_label?: string | null
          previous_rank_reason?: Json | null
          previous_shadow_rank?: number | null
          previous_shadow_rank_tier?: string | null
          replaced_at?: string
          title?: string | null
        }
        Update: {
          podcast_id?: string
          previous_podiverzum_rank?: number | null
          previous_rank_label?: string | null
          previous_rank_reason?: Json | null
          previous_shadow_rank?: number | null
          previous_shadow_rank_tier?: string | null
          replaced_at?: string
          title?: string | null
        }
        Relationships: []
      }
      mood_collections: {
        Row: {
          accent_hsl: string | null
          active: boolean
          created_at: string
          default_reason_label: string | null
          description: string | null
          energy_level: string
          episode_ids: string[]
          evergreen_weight: number
          freshness_weight: number
          id: string
          is_indexable: boolean
          mood: string
          negative_title_patterns: string[] | null
          negative_topic_hints: string[]
          podcast_ids: string[]
          positive_topic_hints: string[]
          preferred_duration_max: number | null
          preferred_duration_min: number | null
          recommended_episode_count: number
          seed_embedding: string | null
          seed_query: string | null
          short_description: string | null
          slug: string
          sort_order: number
          source_quality_weight: number
          time_affinity: Json
          title: string
          updated_at: string
        }
        Insert: {
          accent_hsl?: string | null
          active?: boolean
          created_at?: string
          default_reason_label?: string | null
          description?: string | null
          energy_level?: string
          episode_ids?: string[]
          evergreen_weight?: number
          freshness_weight?: number
          id?: string
          is_indexable?: boolean
          mood: string
          negative_title_patterns?: string[] | null
          negative_topic_hints?: string[]
          podcast_ids?: string[]
          positive_topic_hints?: string[]
          preferred_duration_max?: number | null
          preferred_duration_min?: number | null
          recommended_episode_count?: number
          seed_embedding?: string | null
          seed_query?: string | null
          short_description?: string | null
          slug: string
          sort_order?: number
          source_quality_weight?: number
          time_affinity?: Json
          title: string
          updated_at?: string
        }
        Update: {
          accent_hsl?: string | null
          active?: boolean
          created_at?: string
          default_reason_label?: string | null
          description?: string | null
          energy_level?: string
          episode_ids?: string[]
          evergreen_weight?: number
          freshness_weight?: number
          id?: string
          is_indexable?: boolean
          mood?: string
          negative_title_patterns?: string[] | null
          negative_topic_hints?: string[]
          podcast_ids?: string[]
          positive_topic_hints?: string[]
          preferred_duration_max?: number | null
          preferred_duration_min?: number | null
          recommended_episode_count?: number
          seed_embedding?: string | null
          seed_query?: string | null
          short_description?: string | null
          slug?: string
          sort_order?: number
          source_quality_weight?: number
          time_affinity?: Json
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      org_ai_review_jobs: {
        Row: {
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          input_snapshot: Json
          organization_id: string
          output_snapshot: Json
          started_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input_snapshot?: Json
          organization_id: string
          output_snapshot?: Json
          started_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input_snapshot?: Json
          organization_id?: string
          output_snapshot?: Json
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      organization_aliases: {
        Row: {
          alias: string
          confidence: number
          created_at: string
          id: string
          normalized_alias: string
          organization_id: string
          source: string | null
          status: string
        }
        Insert: {
          alias: string
          confidence?: number
          created_at?: string
          id?: string
          normalized_alias: string
          organization_id: string
          source?: string | null
          status?: string
        }
        Update: {
          alias?: string
          confidence?: number
          created_at?: string
          id?: string
          normalized_alias?: string
          organization_id?: string
          source?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_aliases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          ai_bio: string | null
          ai_bio_confidence: number
          ai_bio_generated_at: string | null
          ai_bio_model: string | null
          ai_bio_status: string
          ai_duplicate_of_organization_id: string | null
          ai_recommended_action: string | null
          ai_recommended_canonical_name: string | null
          ai_recommended_org_type: string | null
          ai_review_confidence: number
          ai_review_flags: string[]
          ai_review_model: string | null
          ai_review_score: number
          ai_review_sources: Json
          ai_review_status: string
          ai_review_summary: string | null
          ai_reviewed_at: string | null
          browsable_reason: string | null
          country: string | null
          created_at: string
          distinct_podcast_count: number
          editorial_notes: string | null
          editorial_priority: boolean
          editorial_priority_level: number
          episode_count: number
          founded: string | null
          gated_episode_count: number
          gated_podcast_count: number
          headquarters: string | null
          id: string
          is_browsable_in_hub: boolean
          is_indexable: boolean
          is_podcast_internal: boolean
          is_public: boolean
          latest_episode_at: string | null
          logo_attribution: string | null
          logo_license: string | null
          logo_source: string | null
          logo_storage_path: string | null
          logo_url: string | null
          manually_seeded: boolean
          mention_count: number
          name: string
          normalized_name: string
          org_type: string
          podcast_count: number
          podcast_internal_reason: string | null
          political_color: string | null
          political_orientation: string | null
          primary_count: number
          sector: string | null
          short_description_hu: string | null
          slug: string
          source_podcast_ids: string[]
          ticker: string | null
          updated_at: string
          wiki_match_reason: string | null
          wiki_match_run_at: string | null
          wikidata_id: string | null
          wikipedia_description: string | null
          wikipedia_extract: string | null
          wikipedia_match_confidence: number
          wikipedia_match_evidence: Json
          wikipedia_match_status: string
          wikipedia_title: string | null
          wikipedia_url: string | null
        }
        Insert: {
          ai_bio?: string | null
          ai_bio_confidence?: number
          ai_bio_generated_at?: string | null
          ai_bio_model?: string | null
          ai_bio_status?: string
          ai_duplicate_of_organization_id?: string | null
          ai_recommended_action?: string | null
          ai_recommended_canonical_name?: string | null
          ai_recommended_org_type?: string | null
          ai_review_confidence?: number
          ai_review_flags?: string[]
          ai_review_model?: string | null
          ai_review_score?: number
          ai_review_sources?: Json
          ai_review_status?: string
          ai_review_summary?: string | null
          ai_reviewed_at?: string | null
          browsable_reason?: string | null
          country?: string | null
          created_at?: string
          distinct_podcast_count?: number
          editorial_notes?: string | null
          editorial_priority?: boolean
          editorial_priority_level?: number
          episode_count?: number
          founded?: string | null
          gated_episode_count?: number
          gated_podcast_count?: number
          headquarters?: string | null
          id?: string
          is_browsable_in_hub?: boolean
          is_indexable?: boolean
          is_podcast_internal?: boolean
          is_public?: boolean
          latest_episode_at?: string | null
          logo_attribution?: string | null
          logo_license?: string | null
          logo_source?: string | null
          logo_storage_path?: string | null
          logo_url?: string | null
          manually_seeded?: boolean
          mention_count?: number
          name: string
          normalized_name: string
          org_type?: string
          podcast_count?: number
          podcast_internal_reason?: string | null
          political_color?: string | null
          political_orientation?: string | null
          primary_count?: number
          sector?: string | null
          short_description_hu?: string | null
          slug: string
          source_podcast_ids?: string[]
          ticker?: string | null
          updated_at?: string
          wiki_match_reason?: string | null
          wiki_match_run_at?: string | null
          wikidata_id?: string | null
          wikipedia_description?: string | null
          wikipedia_extract?: string | null
          wikipedia_match_confidence?: number
          wikipedia_match_evidence?: Json
          wikipedia_match_status?: string
          wikipedia_title?: string | null
          wikipedia_url?: string | null
        }
        Update: {
          ai_bio?: string | null
          ai_bio_confidence?: number
          ai_bio_generated_at?: string | null
          ai_bio_model?: string | null
          ai_bio_status?: string
          ai_duplicate_of_organization_id?: string | null
          ai_recommended_action?: string | null
          ai_recommended_canonical_name?: string | null
          ai_recommended_org_type?: string | null
          ai_review_confidence?: number
          ai_review_flags?: string[]
          ai_review_model?: string | null
          ai_review_score?: number
          ai_review_sources?: Json
          ai_review_status?: string
          ai_review_summary?: string | null
          ai_reviewed_at?: string | null
          browsable_reason?: string | null
          country?: string | null
          created_at?: string
          distinct_podcast_count?: number
          editorial_notes?: string | null
          editorial_priority?: boolean
          editorial_priority_level?: number
          episode_count?: number
          founded?: string | null
          gated_episode_count?: number
          gated_podcast_count?: number
          headquarters?: string | null
          id?: string
          is_browsable_in_hub?: boolean
          is_indexable?: boolean
          is_podcast_internal?: boolean
          is_public?: boolean
          latest_episode_at?: string | null
          logo_attribution?: string | null
          logo_license?: string | null
          logo_source?: string | null
          logo_storage_path?: string | null
          logo_url?: string | null
          manually_seeded?: boolean
          mention_count?: number
          name?: string
          normalized_name?: string
          org_type?: string
          podcast_count?: number
          podcast_internal_reason?: string | null
          political_color?: string | null
          political_orientation?: string | null
          primary_count?: number
          sector?: string | null
          short_description_hu?: string | null
          slug?: string
          source_podcast_ids?: string[]
          ticker?: string | null
          updated_at?: string
          wiki_match_reason?: string | null
          wiki_match_run_at?: string | null
          wikidata_id?: string | null
          wikipedia_description?: string | null
          wikipedia_extract?: string | null
          wikipedia_match_confidence?: number
          wikipedia_match_evidence?: Json
          wikipedia_match_status?: string
          wikipedia_title?: string | null
          wikipedia_url?: string | null
        }
        Relationships: []
      }
      page_events: {
        Row: {
          created_at: string
          dwell_ms: number | null
          full_url: string | null
          id: string
          is_bot: boolean | null
          path: string
          referrer: string | null
          session_id: string | null
          ua_browser: string | null
          ua_os: string | null
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
          dwell_ms?: number | null
          full_url?: string | null
          id?: string
          is_bot?: boolean | null
          path: string
          referrer?: string | null
          session_id?: string | null
          ua_browser?: string | null
          ua_os?: string | null
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
          dwell_ms?: number | null
          full_url?: string | null
          id?: string
          is_bot?: boolean | null
          path?: string
          referrer?: string | null
          session_id?: string | null
          ua_browser?: string | null
          ua_os?: string | null
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
      people: {
        Row: {
          activated_at: string | null
          activation_reason: string | null
          activation_status: string
          ai_bio: string | null
          ai_bio_confidence: number
          ai_bio_generated_at: string | null
          ai_bio_model: string | null
          ai_bio_sources: Json
          ai_bio_status: string
          ai_duplicate_of_person_id: string | null
          ai_recommended_action: string | null
          ai_recommended_canonical_name: string | null
          ai_recommended_slug: string | null
          ai_review_confidence: number | null
          ai_review_flags: string[]
          ai_review_model: string | null
          ai_review_score: number | null
          ai_review_sources: Json
          ai_review_status: string
          ai_review_summary: string | null
          ai_reviewed_at: string | null
          avg_source_podcast_rank: number
          browsable_reason: string | null
          canonical_identity_key: string | null
          collision_risk_score: number
          collision_signals: Json
          confidence: number
          created_at: string
          date_of_birth: string | null
          date_of_death: string | null
          disambiguation_context: string | null
          disambiguation_label: string | null
          distinct_podcast_count: number
          duplicate_candidate: boolean
          editorial_notes: string | null
          editorial_priority: boolean
          editorial_priority_level: number
          entity_type: string
          episode_count: number
          gated_episode_count: number
          gated_podcast_count: number
          guest_count: number
          has_archival_evidence: boolean
          host_count: number
          id: string
          identity_ambiguous: boolean
          identity_confidence: number
          identity_status: string
          image_attribution: string | null
          image_author: string | null
          image_checked_at: string | null
          image_license: string | null
          image_license_url: string | null
          image_original_url: string | null
          image_source: string | null
          image_status: string
          image_storage_path: string | null
          image_url: string | null
          is_browsable_in_people_hub: boolean
          is_deceased: boolean
          is_historical: boolean
          is_indexable: boolean
          is_living: boolean | null
          is_public: boolean
          is_topic_only: boolean
          latest_accepted_relevant_episode_at: string | null
          latest_episode_at: string | null
          manual_approval_status: string
          manual_approved: boolean
          manually_seeded: boolean
          mention_count: number
          mentioned_count: number
          name: string
          needs_human_review_identity: boolean
          normalized_name: string
          occupation_labels: string[]
          one_show_host: boolean
          overview_generated_at: string | null
          overview_sources: Json
          overview_text: string | null
          participant_count: number
          people_hub_score: number
          persona: string
          podcast_count: number
          recent_relevant_episode_count_30d: number
          short_bio: string | null
          short_description_hu: string | null
          slug: string
          strong_mention_count: number
          subject_count: number
          topic_figure_origin: string | null
          topic_figure_seeded: boolean
          updated_at: string
          wiki_match_reason: string | null
          wiki_match_run_at: string | null
          wikidata_id: string | null
          wikipedia_description: string | null
          wikipedia_extract: string | null
          wikipedia_match_confidence: number
          wikipedia_match_evidence: Json
          wikipedia_match_status: string
          wikipedia_title: string | null
          wikipedia_url: string | null
        }
        Insert: {
          activated_at?: string | null
          activation_reason?: string | null
          activation_status?: string
          ai_bio?: string | null
          ai_bio_confidence?: number
          ai_bio_generated_at?: string | null
          ai_bio_model?: string | null
          ai_bio_sources?: Json
          ai_bio_status?: string
          ai_duplicate_of_person_id?: string | null
          ai_recommended_action?: string | null
          ai_recommended_canonical_name?: string | null
          ai_recommended_slug?: string | null
          ai_review_confidence?: number | null
          ai_review_flags?: string[]
          ai_review_model?: string | null
          ai_review_score?: number | null
          ai_review_sources?: Json
          ai_review_status?: string
          ai_review_summary?: string | null
          ai_reviewed_at?: string | null
          avg_source_podcast_rank?: number
          browsable_reason?: string | null
          canonical_identity_key?: string | null
          collision_risk_score?: number
          collision_signals?: Json
          confidence?: number
          created_at?: string
          date_of_birth?: string | null
          date_of_death?: string | null
          disambiguation_context?: string | null
          disambiguation_label?: string | null
          distinct_podcast_count?: number
          duplicate_candidate?: boolean
          editorial_notes?: string | null
          editorial_priority?: boolean
          editorial_priority_level?: number
          entity_type?: string
          episode_count?: number
          gated_episode_count?: number
          gated_podcast_count?: number
          guest_count?: number
          has_archival_evidence?: boolean
          host_count?: number
          id?: string
          identity_ambiguous?: boolean
          identity_confidence?: number
          identity_status?: string
          image_attribution?: string | null
          image_author?: string | null
          image_checked_at?: string | null
          image_license?: string | null
          image_license_url?: string | null
          image_original_url?: string | null
          image_source?: string | null
          image_status?: string
          image_storage_path?: string | null
          image_url?: string | null
          is_browsable_in_people_hub?: boolean
          is_deceased?: boolean
          is_historical?: boolean
          is_indexable?: boolean
          is_living?: boolean | null
          is_public?: boolean
          is_topic_only?: boolean
          latest_accepted_relevant_episode_at?: string | null
          latest_episode_at?: string | null
          manual_approval_status?: string
          manual_approved?: boolean
          manually_seeded?: boolean
          mention_count?: number
          mentioned_count?: number
          name: string
          needs_human_review_identity?: boolean
          normalized_name: string
          occupation_labels?: string[]
          one_show_host?: boolean
          overview_generated_at?: string | null
          overview_sources?: Json
          overview_text?: string | null
          participant_count?: number
          people_hub_score?: number
          persona?: string
          podcast_count?: number
          recent_relevant_episode_count_30d?: number
          short_bio?: string | null
          short_description_hu?: string | null
          slug: string
          strong_mention_count?: number
          subject_count?: number
          topic_figure_origin?: string | null
          topic_figure_seeded?: boolean
          updated_at?: string
          wiki_match_reason?: string | null
          wiki_match_run_at?: string | null
          wikidata_id?: string | null
          wikipedia_description?: string | null
          wikipedia_extract?: string | null
          wikipedia_match_confidence?: number
          wikipedia_match_evidence?: Json
          wikipedia_match_status?: string
          wikipedia_title?: string | null
          wikipedia_url?: string | null
        }
        Update: {
          activated_at?: string | null
          activation_reason?: string | null
          activation_status?: string
          ai_bio?: string | null
          ai_bio_confidence?: number
          ai_bio_generated_at?: string | null
          ai_bio_model?: string | null
          ai_bio_sources?: Json
          ai_bio_status?: string
          ai_duplicate_of_person_id?: string | null
          ai_recommended_action?: string | null
          ai_recommended_canonical_name?: string | null
          ai_recommended_slug?: string | null
          ai_review_confidence?: number | null
          ai_review_flags?: string[]
          ai_review_model?: string | null
          ai_review_score?: number | null
          ai_review_sources?: Json
          ai_review_status?: string
          ai_review_summary?: string | null
          ai_reviewed_at?: string | null
          avg_source_podcast_rank?: number
          browsable_reason?: string | null
          canonical_identity_key?: string | null
          collision_risk_score?: number
          collision_signals?: Json
          confidence?: number
          created_at?: string
          date_of_birth?: string | null
          date_of_death?: string | null
          disambiguation_context?: string | null
          disambiguation_label?: string | null
          distinct_podcast_count?: number
          duplicate_candidate?: boolean
          editorial_notes?: string | null
          editorial_priority?: boolean
          editorial_priority_level?: number
          entity_type?: string
          episode_count?: number
          gated_episode_count?: number
          gated_podcast_count?: number
          guest_count?: number
          has_archival_evidence?: boolean
          host_count?: number
          id?: string
          identity_ambiguous?: boolean
          identity_confidence?: number
          identity_status?: string
          image_attribution?: string | null
          image_author?: string | null
          image_checked_at?: string | null
          image_license?: string | null
          image_license_url?: string | null
          image_original_url?: string | null
          image_source?: string | null
          image_status?: string
          image_storage_path?: string | null
          image_url?: string | null
          is_browsable_in_people_hub?: boolean
          is_deceased?: boolean
          is_historical?: boolean
          is_indexable?: boolean
          is_living?: boolean | null
          is_public?: boolean
          is_topic_only?: boolean
          latest_accepted_relevant_episode_at?: string | null
          latest_episode_at?: string | null
          manual_approval_status?: string
          manual_approved?: boolean
          manually_seeded?: boolean
          mention_count?: number
          mentioned_count?: number
          name?: string
          needs_human_review_identity?: boolean
          normalized_name?: string
          occupation_labels?: string[]
          one_show_host?: boolean
          overview_generated_at?: string | null
          overview_sources?: Json
          overview_text?: string | null
          participant_count?: number
          people_hub_score?: number
          persona?: string
          podcast_count?: number
          recent_relevant_episode_count_30d?: number
          short_bio?: string | null
          short_description_hu?: string | null
          slug?: string
          strong_mention_count?: number
          subject_count?: number
          topic_figure_origin?: string | null
          topic_figure_seeded?: boolean
          updated_at?: string
          wiki_match_reason?: string | null
          wiki_match_run_at?: string | null
          wikidata_id?: string | null
          wikipedia_description?: string | null
          wikipedia_extract?: string | null
          wikipedia_match_confidence?: number
          wikipedia_match_evidence?: Json
          wikipedia_match_status?: string
          wikipedia_title?: string | null
          wikipedia_url?: string | null
        }
        Relationships: []
      }
      person_ai_review_jobs: {
        Row: {
          attempt_count: number
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          input_snapshot: Json
          output_snapshot: Json
          person_id: string
          priority: number
          started_at: string | null
          status: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input_snapshot?: Json
          output_snapshot?: Json
          person_id: string
          priority?: number
          started_at?: string | null
          status?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input_snapshot?: Json
          output_snapshot?: Json
          person_id?: string
          priority?: number
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_ai_review_jobs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_ai_review_jobs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_activation_status_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_ai_review_jobs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_ai_action_queue_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_ai_review_jobs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_ai_duplicate_candidates_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_ai_review_jobs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_missing_content_review_view"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "person_ai_review_jobs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_duplicate_clusters"
            referencedColumns: ["person_a_id"]
          },
          {
            foreignKeyName: "person_ai_review_jobs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_duplicate_clusters"
            referencedColumns: ["person_b_id"]
          },
          {
            foreignKeyName: "person_ai_review_jobs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_high_reject_ratio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_ai_review_jobs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_pending_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_ai_review_jobs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_surname_only_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_ai_review_jobs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_weak_public_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      person_aliases: {
        Row: {
          alias: string
          confidence: number
          created_at: string
          id: string
          normalized_alias: string
          person_id: string
          review_reason: string | null
          reviewed_at: string | null
          scope: string
          scope_episode_id: string | null
          scope_podcast_id: string | null
          source: string | null
          status: string
        }
        Insert: {
          alias: string
          confidence?: number
          created_at?: string
          id?: string
          normalized_alias: string
          person_id: string
          review_reason?: string | null
          reviewed_at?: string | null
          scope?: string
          scope_episode_id?: string | null
          scope_podcast_id?: string | null
          source?: string | null
          status?: string
        }
        Update: {
          alias?: string
          confidence?: number
          created_at?: string
          id?: string
          normalized_alias?: string
          person_id?: string
          review_reason?: string | null
          reviewed_at?: string | null
          scope?: string
          scope_episode_id?: string | null
          scope_podcast_id?: string | null
          source?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_activation_status_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_ai_action_queue_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_ai_duplicate_candidates_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_missing_content_review_view"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_duplicate_clusters"
            referencedColumns: ["person_a_id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_duplicate_clusters"
            referencedColumns: ["person_b_id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_high_reject_ratio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_pending_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_surname_only_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_weak_public_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      person_common_surname_watchlist: {
        Row: {
          created_at: string
          normalized: string
          reason: string | null
          surname: string
        }
        Insert: {
          created_at?: string
          normalized: string
          reason?: string | null
          surname: string
        }
        Update: {
          created_at?: string
          normalized?: string
          reason?: string | null
          surname?: string
        }
        Relationships: []
      }
      person_enrichment_jobs: {
        Row: {
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          input_snapshot: Json
          job_type: string
          output_snapshot: Json
          person_id: string
          started_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input_snapshot?: Json
          job_type: string
          output_snapshot?: Json
          person_id: string
          started_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          input_snapshot?: Json
          job_type?: string
          output_snapshot?: Json
          person_id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      person_episode_mentions: {
        Row: {
          ai_evidence_phrases: string[]
          ai_identity_match: string | null
          ai_judged_at: string | null
          ai_model: string | null
          ai_reason: string | null
          confidence: number
          created_at: string
          episode_id: string
          evidence: string | null
          final_relevance_score: number | null
          id: string
          mention_type: string
          person_id: string
          podcast_id: string
          relevance_status: string
          role_confidence: number | null
          role_reason: string | null
          role_type: string | null
          source: string | null
          source_evidence: Json
          validation_source: string | null
        }
        Insert: {
          ai_evidence_phrases?: string[]
          ai_identity_match?: string | null
          ai_judged_at?: string | null
          ai_model?: string | null
          ai_reason?: string | null
          confidence?: number
          created_at?: string
          episode_id: string
          evidence?: string | null
          final_relevance_score?: number | null
          id?: string
          mention_type?: string
          person_id: string
          podcast_id: string
          relevance_status?: string
          role_confidence?: number | null
          role_reason?: string | null
          role_type?: string | null
          source?: string | null
          source_evidence?: Json
          validation_source?: string | null
        }
        Update: {
          ai_evidence_phrases?: string[]
          ai_identity_match?: string | null
          ai_judged_at?: string | null
          ai_model?: string | null
          ai_reason?: string | null
          confidence?: number
          created_at?: string
          episode_id?: string
          evidence?: string | null
          final_relevance_score?: number | null
          id?: string
          mention_type?: string
          person_id?: string
          podcast_id?: string
          relevance_status?: string
          role_confidence?: number | null
          role_reason?: string | null
          role_type?: string | null
          source?: string | null
          source_evidence?: Json
          validation_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "person_episode_mentions_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_episode_mentions_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "person_episode_mentions_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "person_episode_mentions_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_data_quality_issues"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "person_episode_mentions_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_quality_indicator_audit"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "person_episode_mentions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_episode_mentions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_activation_status_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_episode_mentions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_ai_action_queue_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_episode_mentions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_ai_duplicate_candidates_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_episode_mentions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_missing_content_review_view"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "person_episode_mentions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_duplicate_clusters"
            referencedColumns: ["person_a_id"]
          },
          {
            foreignKeyName: "person_episode_mentions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_duplicate_clusters"
            referencedColumns: ["person_b_id"]
          },
          {
            foreignKeyName: "person_episode_mentions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_high_reject_ratio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_episode_mentions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_pending_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_episode_mentions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_surname_only_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_episode_mentions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_weak_public_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_episode_mentions_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "person_episode_mentions_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "person_episode_mentions_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_episode_mentions_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_hu_archive_completeness"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "person_episode_mentions_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_youtube_native_transcript_candidates"
            referencedColumns: ["podcast_id"]
          },
        ]
      }
      person_podcast_map: {
        Row: {
          confidence: number
          created_at: string
          episode_count: number
          id: string
          latest_episode_at: string | null
          person_id: string
          podcast_id: string
          role: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          episode_count?: number
          id?: string
          latest_episode_at?: string | null
          person_id: string
          podcast_id: string
          role?: string
        }
        Update: {
          confidence?: number
          created_at?: string
          episode_count?: number
          id?: string
          latest_episode_at?: string | null
          person_id?: string
          podcast_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_podcast_map_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_podcast_map_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_activation_status_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_podcast_map_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_ai_action_queue_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_podcast_map_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_ai_duplicate_candidates_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_podcast_map_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_missing_content_review_view"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "person_podcast_map_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_duplicate_clusters"
            referencedColumns: ["person_a_id"]
          },
          {
            foreignKeyName: "person_podcast_map_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_duplicate_clusters"
            referencedColumns: ["person_b_id"]
          },
          {
            foreignKeyName: "person_podcast_map_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_high_reject_ratio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_podcast_map_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_pending_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_podcast_map_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_surname_only_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_podcast_map_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_weak_public_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_podcast_map_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "person_podcast_map_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "person_podcast_map_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_podcast_map_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_hu_archive_completeness"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "person_podcast_map_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_youtube_native_transcript_candidates"
            referencedColumns: ["podcast_id"]
          },
        ]
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
          rss_url_norm: string | null
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
          rss_url_norm?: string | null
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
          rss_url_norm?: string | null
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
      playback_progress: {
        Row: {
          completed: boolean
          duration_seconds: number | null
          episode_id: string
          position_seconds: number
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          duration_seconds?: number | null
          episode_id: string
          position_seconds?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          duration_seconds?: number | null
          episode_id?: string
          position_seconds?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      player_events: {
        Row: {
          created_at: string
          duration_sec: number | null
          episode_id: string | null
          event_type: string
          id: string
          meta: Json
          playback_rate: number | null
          podcast_id: string | null
          position_sec: number | null
          session_id: string | null
          user_agent: string | null
          viewport_width: number | null
        }
        Insert: {
          created_at?: string
          duration_sec?: number | null
          episode_id?: string | null
          event_type: string
          id?: string
          meta?: Json
          playback_rate?: number | null
          podcast_id?: string | null
          position_sec?: number | null
          session_id?: string | null
          user_agent?: string | null
          viewport_width?: number | null
        }
        Update: {
          created_at?: string
          duration_sec?: number | null
          episode_id?: string | null
          event_type?: string
          id?: string
          meta?: Json
          playback_rate?: number | null
          podcast_id?: string | null
          position_sec?: number | null
          session_id?: string | null
          user_agent?: string | null
          viewport_width?: number | null
        }
        Relationships: []
      }
      podcast_aliases: {
        Row: {
          alias: string
          confidence: number
          created_at: string
          id: string
          normalized_alias: string
          podcast_id: string
          source: string
        }
        Insert: {
          alias: string
          confidence?: number
          created_at?: string
          id?: string
          normalized_alias: string
          podcast_id: string
          source?: string
        }
        Update: {
          alias?: string
          confidence?: number
          created_at?: string
          id?: string
          normalized_alias?: string
          podcast_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "podcast_aliases_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "podcast_aliases_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "podcast_aliases_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcast_aliases_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_hu_archive_completeness"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "podcast_aliases_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_youtube_native_transcript_candidates"
            referencedColumns: ["podcast_id"]
          },
        ]
      }
      podcast_boilerplate_blocks: {
        Row: {
          block_hash: string
          block_text: string
          detected_at: string
          hit_count: number
          podcast_id: string
        }
        Insert: {
          block_hash: string
          block_text: string
          detected_at?: string
          hit_count?: number
          podcast_id: string
        }
        Update: {
          block_hash?: string
          block_text?: string
          detected_at?: string
          hit_count?: number
          podcast_id?: string
        }
        Relationships: []
      }
      podcast_charts: {
        Row: {
          country: string
          created_at: string
          id: string
          image_url: string | null
          matched_via: string | null
          podcast_id: string | null
          rank: number
          raw_artist: string | null
          raw_external_id: string | null
          raw_name: string
          raw_url: string | null
          snapshot_at: string
          source: string
        }
        Insert: {
          country?: string
          created_at?: string
          id?: string
          image_url?: string | null
          matched_via?: string | null
          podcast_id?: string | null
          rank: number
          raw_artist?: string | null
          raw_external_id?: string | null
          raw_name: string
          raw_url?: string | null
          snapshot_at?: string
          source: string
        }
        Update: {
          country?: string
          created_at?: string
          id?: string
          image_url?: string | null
          matched_via?: string | null
          podcast_id?: string | null
          rank?: number
          raw_artist?: string | null
          raw_external_id?: string | null
          raw_name?: string
          raw_url?: string | null
          snapshot_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "podcast_charts_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "podcast_charts_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "podcast_charts_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcast_charts_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_hu_archive_completeness"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "podcast_charts_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_youtube_native_transcript_candidates"
            referencedColumns: ["podcast_id"]
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
      podcast_language_cleanup_log: {
        Row: {
          deleted_ai_job_count: number
          deleted_at: string
          deleted_embedding_count: number
          deleted_related_episode_count: number
          deletion_reason: string
          detected_language: string | null
          evidence: Json
          foreign_score: number | null
          hungarian_score: number | null
          id: string
          podcast_id: string | null
          rss_url: string | null
          title: string | null
        }
        Insert: {
          deleted_ai_job_count?: number
          deleted_at?: string
          deleted_embedding_count?: number
          deleted_related_episode_count?: number
          deletion_reason: string
          detected_language?: string | null
          evidence?: Json
          foreign_score?: number | null
          hungarian_score?: number | null
          id?: string
          podcast_id?: string | null
          rss_url?: string | null
          title?: string | null
        }
        Update: {
          deleted_ai_job_count?: number
          deleted_at?: string
          deleted_embedding_count?: number
          deleted_related_episode_count?: number
          deletion_reason?: string
          detected_language?: string | null
          evidence?: Json
          foreign_score?: number | null
          hungarian_score?: number | null
          id?: string
          podcast_id?: string | null
          rss_url?: string | null
          title?: string | null
        }
        Relationships: []
      }
      podcast_language_review_queue: {
        Row: {
          created_at: string
          detected_language: string | null
          evidence: Json
          foreign_score: number | null
          hungarian_score: number | null
          id: string
          podcast_id: string
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rss_url: string | null
          status: string
          title: string | null
          website_url: string | null
        }
        Insert: {
          created_at?: string
          detected_language?: string | null
          evidence?: Json
          foreign_score?: number | null
          hungarian_score?: number | null
          id?: string
          podcast_id: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rss_url?: string | null
          status?: string
          title?: string | null
          website_url?: string | null
        }
        Update: {
          created_at?: string
          detected_language?: string | null
          evidence?: Json
          foreign_score?: number | null
          hungarian_score?: number | null
          id?: string
          podcast_id?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rss_url?: string | null
          status?: string
          title?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      podcast_outreach_contacts: {
        Row: {
          created_at: string
          extract_error: string | null
          extract_status: string
          extracted_at: string | null
          extracted_from: string | null
          id: string
          last_contacted_at: string | null
          notes: string | null
          outreach_status: string
          owner_email: string | null
          owner_name: string | null
          podcast_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          extract_error?: string | null
          extract_status?: string
          extracted_at?: string | null
          extracted_from?: string | null
          id?: string
          last_contacted_at?: string | null
          notes?: string | null
          outreach_status?: string
          owner_email?: string | null
          owner_name?: string | null
          podcast_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          extract_error?: string | null
          extract_status?: string
          extracted_at?: string | null
          extracted_from?: string | null
          id?: string
          last_contacted_at?: string | null
          notes?: string | null
          outreach_status?: string
          owner_email?: string | null
          owner_name?: string | null
          podcast_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "podcast_outreach_contacts_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: true
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "podcast_outreach_contacts_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: true
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "podcast_outreach_contacts_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: true
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcast_outreach_contacts_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: true
            referencedRelation: "v_hu_archive_completeness"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "podcast_outreach_contacts_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: true
            referencedRelation: "v_youtube_native_transcript_candidates"
            referencedColumns: ["podcast_id"]
          },
        ]
      }
      podcast_spotify_snapshots: {
        Row: {
          captured_at: string
          followers: number | null
          id: number
          podcast_id: string
          popularity: number | null
          snapshot_date: string
          spotify_id: string
          total_episodes: number | null
        }
        Insert: {
          captured_at?: string
          followers?: number | null
          id?: number
          podcast_id: string
          popularity?: number | null
          snapshot_date?: string
          spotify_id: string
          total_episodes?: number | null
        }
        Update: {
          captured_at?: string
          followers?: number | null
          id?: number
          podcast_id?: string
          popularity?: number | null
          snapshot_date?: string
          spotify_id?: string
          total_episodes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "podcast_spotify_snapshots_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "podcast_spotify_snapshots_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "podcast_spotify_snapshots_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcast_spotify_snapshots_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_hu_archive_completeness"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "podcast_spotify_snapshots_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_youtube_native_transcript_candidates"
            referencedColumns: ["podcast_id"]
          },
        ]
      }
      podcast_topic_map: {
        Row: {
          confidence: number
          created_at: string
          podcast_id: string
          source: string | null
          topic_id: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          podcast_id: string
          source?: string | null
          topic_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          podcast_id?: string
          source?: string | null
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "podcast_topic_map_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "podcast_topic_map_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "podcast_topic_map_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcast_topic_map_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_hu_archive_completeness"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "podcast_topic_map_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_youtube_native_transcript_candidates"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "podcast_topic_map_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "podcast_topic_map_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "v_canonical_topic_aliases"
            referencedColumns: ["topic_id"]
          },
        ]
      }
      podcast_youtube_candidates: {
        Row: {
          channel_description: string | null
          channel_thumbnail_url: string | null
          channel_title: string | null
          confidence: string
          created_at: string
          found_by: string | null
          id: string
          match_score: number | null
          podcast_id: string
          status: string
          subscriber_count: number | null
          updated_at: string
          validated_by: string | null
          validation_reason: Json
          video_count: number | null
          youtube_channel_id: string
        }
        Insert: {
          channel_description?: string | null
          channel_thumbnail_url?: string | null
          channel_title?: string | null
          confidence?: string
          created_at?: string
          found_by?: string | null
          id?: string
          match_score?: number | null
          podcast_id: string
          status?: string
          subscriber_count?: number | null
          updated_at?: string
          validated_by?: string | null
          validation_reason?: Json
          video_count?: number | null
          youtube_channel_id: string
        }
        Update: {
          channel_description?: string | null
          channel_thumbnail_url?: string | null
          channel_title?: string | null
          confidence?: string
          created_at?: string
          found_by?: string | null
          id?: string
          match_score?: number | null
          podcast_id?: string
          status?: string
          subscriber_count?: number | null
          updated_at?: string
          validated_by?: string | null
          validation_reason?: Json
          video_count?: number | null
          youtube_channel_id?: string
        }
        Relationships: []
      }
      podcasts: {
        Row: {
          ai_category_alt: string | null
          ai_category_at: string | null
          ai_category_confidence: number | null
          ai_category_model: string | null
          ai_category_needs_review: boolean | null
          ai_enrich_input_hash: string | null
          ai_enrich_prompt_version: string | null
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
          detected_language: string | null
          display_title: string | null
          featured: boolean
          featured_rank: number | null
          foreign_score: number | null
          full_backfill_completed_at: string | null
          hosts: string[]
          hosts_source: string | null
          hosts_updated_at: string | null
          hungarian_score: number | null
          hydrated_episode_count: number
          id: string
          image_url: string | null
          is_hungarian: boolean
          is_sample: boolean
          language: string | null
          language_checked_at: string | null
          language_decision: string | null
          language_evidence: Json
          language_rejection_reason: string | null
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
          normalized_title: string | null
          pi_backfill_approved: boolean | null
          pi_backfill_completed_at: string | null
          pi_backfill_dry_run: Json | null
          pi_backfill_episode_count: number | null
          pi_backfill_error: string | null
          pi_backfill_peeked_at: string | null
          podiverzum_rank: number
          quarantined_until: string | null
          rank_label: string | null
          rank_reason: Json
          rank_updated_at: string | null
          refresh_interval_minutes: number
          rss_hunt_attempts: number
          rss_status: string
          rss_url: string | null
          rss_url_norm: string | null
          search_text: string | null
          search_tsv: unknown
          seo_description: string | null
          seo_title: string | null
          shadow_computed_at: string | null
          shadow_rank: number | null
          shadow_rank_components: Json
          shadow_rank_tier: string | null
          slug: string
          source: string | null
          spotify_available_markets: string[] | null
          spotify_copyrights: Json | null
          spotify_description: string | null
          spotify_episodes_last_synced_at: string | null
          spotify_explicit: boolean | null
          spotify_followers: number | null
          spotify_html_description: string | null
          spotify_id: string | null
          spotify_image_url: string | null
          spotify_image_url_300: string | null
          spotify_image_url_64: string | null
          spotify_image_url_640: string | null
          spotify_is_externally_hosted: boolean | null
          spotify_languages: string[] | null
          spotify_last_synced_at: string | null
          spotify_match_confidence: number | null
          spotify_match_method: string | null
          spotify_match_status: string | null
          spotify_media_type: string | null
          spotify_popularity: number | null
          spotify_publisher: string | null
          spotify_show_enriched_at: string | null
          spotify_total_episodes: number | null
          spotify_url: string | null
          summary: string | null
          title: string
          updated_at: string
          website_url: string | null
          youtube_channel_id: string | null
          youtube_channel_title: string | null
          youtube_episode_count: number | null
          youtube_last_episode_pair_at: string | null
          youtube_last_scouted_at: string | null
          youtube_paired_at: string | null
          youtube_pairing_status: string
          youtube_url: string | null
        }
        Insert: {
          ai_category_alt?: string | null
          ai_category_at?: string | null
          ai_category_confidence?: number | null
          ai_category_model?: string | null
          ai_category_needs_review?: boolean | null
          ai_enrich_input_hash?: string | null
          ai_enrich_prompt_version?: string | null
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
          detected_language?: string | null
          display_title?: string | null
          featured?: boolean
          featured_rank?: number | null
          foreign_score?: number | null
          full_backfill_completed_at?: string | null
          hosts?: string[]
          hosts_source?: string | null
          hosts_updated_at?: string | null
          hungarian_score?: number | null
          hydrated_episode_count?: number
          id?: string
          image_url?: string | null
          is_hungarian?: boolean
          is_sample?: boolean
          language?: string | null
          language_checked_at?: string | null
          language_decision?: string | null
          language_evidence?: Json
          language_rejection_reason?: string | null
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
          normalized_title?: string | null
          pi_backfill_approved?: boolean | null
          pi_backfill_completed_at?: string | null
          pi_backfill_dry_run?: Json | null
          pi_backfill_episode_count?: number | null
          pi_backfill_error?: string | null
          pi_backfill_peeked_at?: string | null
          podiverzum_rank?: number
          quarantined_until?: string | null
          rank_label?: string | null
          rank_reason?: Json
          rank_updated_at?: string | null
          refresh_interval_minutes?: number
          rss_hunt_attempts?: number
          rss_status?: string
          rss_url?: string | null
          rss_url_norm?: string | null
          search_text?: string | null
          search_tsv?: unknown
          seo_description?: string | null
          seo_title?: string | null
          shadow_computed_at?: string | null
          shadow_rank?: number | null
          shadow_rank_components?: Json
          shadow_rank_tier?: string | null
          slug: string
          source?: string | null
          spotify_available_markets?: string[] | null
          spotify_copyrights?: Json | null
          spotify_description?: string | null
          spotify_episodes_last_synced_at?: string | null
          spotify_explicit?: boolean | null
          spotify_followers?: number | null
          spotify_html_description?: string | null
          spotify_id?: string | null
          spotify_image_url?: string | null
          spotify_image_url_300?: string | null
          spotify_image_url_64?: string | null
          spotify_image_url_640?: string | null
          spotify_is_externally_hosted?: boolean | null
          spotify_languages?: string[] | null
          spotify_last_synced_at?: string | null
          spotify_match_confidence?: number | null
          spotify_match_method?: string | null
          spotify_match_status?: string | null
          spotify_media_type?: string | null
          spotify_popularity?: number | null
          spotify_publisher?: string | null
          spotify_show_enriched_at?: string | null
          spotify_total_episodes?: number | null
          spotify_url?: string | null
          summary?: string | null
          title: string
          updated_at?: string
          website_url?: string | null
          youtube_channel_id?: string | null
          youtube_channel_title?: string | null
          youtube_episode_count?: number | null
          youtube_last_episode_pair_at?: string | null
          youtube_last_scouted_at?: string | null
          youtube_paired_at?: string | null
          youtube_pairing_status?: string
          youtube_url?: string | null
        }
        Update: {
          ai_category_alt?: string | null
          ai_category_at?: string | null
          ai_category_confidence?: number | null
          ai_category_model?: string | null
          ai_category_needs_review?: boolean | null
          ai_enrich_input_hash?: string | null
          ai_enrich_prompt_version?: string | null
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
          detected_language?: string | null
          display_title?: string | null
          featured?: boolean
          featured_rank?: number | null
          foreign_score?: number | null
          full_backfill_completed_at?: string | null
          hosts?: string[]
          hosts_source?: string | null
          hosts_updated_at?: string | null
          hungarian_score?: number | null
          hydrated_episode_count?: number
          id?: string
          image_url?: string | null
          is_hungarian?: boolean
          is_sample?: boolean
          language?: string | null
          language_checked_at?: string | null
          language_decision?: string | null
          language_evidence?: Json
          language_rejection_reason?: string | null
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
          normalized_title?: string | null
          pi_backfill_approved?: boolean | null
          pi_backfill_completed_at?: string | null
          pi_backfill_dry_run?: Json | null
          pi_backfill_episode_count?: number | null
          pi_backfill_error?: string | null
          pi_backfill_peeked_at?: string | null
          podiverzum_rank?: number
          quarantined_until?: string | null
          rank_label?: string | null
          rank_reason?: Json
          rank_updated_at?: string | null
          refresh_interval_minutes?: number
          rss_hunt_attempts?: number
          rss_status?: string
          rss_url?: string | null
          rss_url_norm?: string | null
          search_text?: string | null
          search_tsv?: unknown
          seo_description?: string | null
          seo_title?: string | null
          shadow_computed_at?: string | null
          shadow_rank?: number | null
          shadow_rank_components?: Json
          shadow_rank_tier?: string | null
          slug?: string
          source?: string | null
          spotify_available_markets?: string[] | null
          spotify_copyrights?: Json | null
          spotify_description?: string | null
          spotify_episodes_last_synced_at?: string | null
          spotify_explicit?: boolean | null
          spotify_followers?: number | null
          spotify_html_description?: string | null
          spotify_id?: string | null
          spotify_image_url?: string | null
          spotify_image_url_300?: string | null
          spotify_image_url_64?: string | null
          spotify_image_url_640?: string | null
          spotify_is_externally_hosted?: boolean | null
          spotify_languages?: string[] | null
          spotify_last_synced_at?: string | null
          spotify_match_confidence?: number | null
          spotify_match_method?: string | null
          spotify_match_status?: string | null
          spotify_media_type?: string | null
          spotify_popularity?: number | null
          spotify_publisher?: string | null
          spotify_show_enriched_at?: string | null
          spotify_total_episodes?: number | null
          spotify_url?: string | null
          summary?: string | null
          title?: string
          updated_at?: string
          website_url?: string | null
          youtube_channel_id?: string | null
          youtube_channel_title?: string | null
          youtube_episode_count?: number | null
          youtube_last_episode_pair_at?: string | null
          youtube_last_scouted_at?: string | null
          youtube_paired_at?: string | null
          youtube_pairing_status?: string
          youtube_url?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          archetype_result: Json | null
          archetype_slug: string | null
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email_notifications_enabled: boolean
          is_public_profile: boolean
          mood_preferences: string[]
          taste_signal_count: number
          taste_vec: string | null
          taste_vec_updated_at: string | null
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          archetype_result?: Json | null
          archetype_slug?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email_notifications_enabled?: boolean
          is_public_profile?: boolean
          mood_preferences?: string[]
          taste_signal_count?: number
          taste_vec?: string | null
          taste_vec_updated_at?: string | null
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          archetype_result?: Json | null
          archetype_slug?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email_notifications_enabled?: boolean
          is_public_profile?: boolean
          mood_preferences?: string[]
          taste_signal_count?: number
          taste_vec?: string | null
          taste_vec_updated_at?: string | null
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      queue_health_events: {
        Row: {
          action: string
          created_at: string
          detail: Json
          id: string
          pending_now: number | null
          pending_prev: number | null
          pending_prev_prev: number | null
          reason: string
          runner: string
        }
        Insert: {
          action: string
          created_at?: string
          detail?: Json
          id?: string
          pending_now?: number | null
          pending_prev?: number | null
          pending_prev_prev?: number | null
          reason: string
          runner: string
        }
        Update: {
          action?: string
          created_at?: string
          detail?: Json
          id?: string
          pending_now?: number | null
          pending_prev?: number | null
          pending_prev_prev?: number | null
          reason?: string
          runner?: string
        }
        Relationships: []
      }
      reddit_bot_log: {
        Row: {
          action: string
          id: number
          matched_kind: string | null
          matched_name: string | null
          matched_url: string | null
          raw: Json | null
          reason: string | null
          response_id: string | null
          subreddit: string | null
          thing_author: string | null
          thing_id: string | null
          thing_kind: string | null
          thing_url: string | null
          ts: string
        }
        Insert: {
          action: string
          id?: number
          matched_kind?: string | null
          matched_name?: string | null
          matched_url?: string | null
          raw?: Json | null
          reason?: string | null
          response_id?: string | null
          subreddit?: string | null
          thing_author?: string | null
          thing_id?: string | null
          thing_kind?: string | null
          thing_url?: string | null
          ts?: string
        }
        Update: {
          action?: string
          id?: number
          matched_kind?: string | null
          matched_name?: string | null
          matched_url?: string | null
          raw?: Json | null
          reason?: string | null
          response_id?: string | null
          subreddit?: string | null
          thing_author?: string | null
          thing_id?: string | null
          thing_kind?: string | null
          thing_url?: string | null
          ts?: string
        }
        Relationships: []
      }
      reddit_bot_opt_out: {
        Row: {
          created_at: string
          reason: string | null
          username: string
        }
        Insert: {
          created_at?: string
          reason?: string | null
          username: string
        }
        Update: {
          created_at?: string
          reason?: string | null
          username?: string
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
      search_benchmark_competitors: {
        Row: {
          collected_at: string
          collected_by: string | null
          golden_id: string
          id: string
          notes: string | null
          precision_at_5: number | null
          scores: Json
          source: string
          top_results: Json
        }
        Insert: {
          collected_at?: string
          collected_by?: string | null
          golden_id: string
          id?: string
          notes?: string | null
          precision_at_5?: number | null
          scores?: Json
          source: string
          top_results?: Json
        }
        Update: {
          collected_at?: string
          collected_by?: string | null
          golden_id?: string
          id?: string
          notes?: string | null
          precision_at_5?: number | null
          scores?: Json
          source?: string
          top_results?: Json
        }
        Relationships: [
          {
            foreignKeyName: "search_benchmark_competitors_golden_id_fkey"
            columns: ["golden_id"]
            isOneToOne: false
            referencedRelation: "search_golden_queries"
            referencedColumns: ["id"]
          },
        ]
      }
      search_benchmark_results: {
        Row: {
          confidence_band: string | null
          created_at: string
          detected_intent: string | null
          golden_id: string
          id: string
          intent_correct: boolean | null
          latency_ms: number | null
          ndcg_at_10: number | null
          notes: string | null
          precision_at_3: number | null
          precision_at_5: number | null
          query: string
          raw_meta: Json
          reciprocal_rank: number | null
          result_count: number
          run_id: string
          scored_at: string | null
          scores: Json
          top_results: Json
          used_cohere: boolean | null
          used_fallback: boolean | null
          used_hyde: boolean | null
          used_must_gate: boolean | null
          used_podcast_pin: boolean | null
          used_vector: boolean | null
        }
        Insert: {
          confidence_band?: string | null
          created_at?: string
          detected_intent?: string | null
          golden_id: string
          id?: string
          intent_correct?: boolean | null
          latency_ms?: number | null
          ndcg_at_10?: number | null
          notes?: string | null
          precision_at_3?: number | null
          precision_at_5?: number | null
          query: string
          raw_meta?: Json
          reciprocal_rank?: number | null
          result_count?: number
          run_id: string
          scored_at?: string | null
          scores?: Json
          top_results?: Json
          used_cohere?: boolean | null
          used_fallback?: boolean | null
          used_hyde?: boolean | null
          used_must_gate?: boolean | null
          used_podcast_pin?: boolean | null
          used_vector?: boolean | null
        }
        Update: {
          confidence_band?: string | null
          created_at?: string
          detected_intent?: string | null
          golden_id?: string
          id?: string
          intent_correct?: boolean | null
          latency_ms?: number | null
          ndcg_at_10?: number | null
          notes?: string | null
          precision_at_3?: number | null
          precision_at_5?: number | null
          query?: string
          raw_meta?: Json
          reciprocal_rank?: number | null
          result_count?: number
          run_id?: string
          scored_at?: string | null
          scores?: Json
          top_results?: Json
          used_cohere?: boolean | null
          used_fallback?: boolean | null
          used_hyde?: boolean | null
          used_must_gate?: boolean | null
          used_podcast_pin?: boolean | null
          used_vector?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "search_benchmark_results_golden_id_fkey"
            columns: ["golden_id"]
            isOneToOne: false
            referencedRelation: "search_golden_queries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_benchmark_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "search_benchmark_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      search_benchmark_runs: {
        Row: {
          created_at: string
          created_by: string | null
          engine: string | null
          false_positive_rate: number | null
          id: string
          intent_accuracy: number | null
          label: string | null
          latency_p50: number | null
          latency_p95: number | null
          mrr: number | null
          ndcg_at_10: number | null
          notes: string | null
          precision_at_3: number | null
          precision_at_5: number | null
          query_count: number
          zero_result_rate: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          engine?: string | null
          false_positive_rate?: number | null
          id?: string
          intent_accuracy?: number | null
          label?: string | null
          latency_p50?: number | null
          latency_p95?: number | null
          mrr?: number | null
          ndcg_at_10?: number | null
          notes?: string | null
          precision_at_3?: number | null
          precision_at_5?: number | null
          query_count?: number
          zero_result_rate?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          engine?: string | null
          false_positive_rate?: number | null
          id?: string
          intent_accuracy?: number | null
          label?: string | null
          latency_p50?: number | null
          latency_p95?: number | null
          mrr?: number | null
          ndcg_at_10?: number | null
          notes?: string | null
          precision_at_3?: number | null
          precision_at_5?: number | null
          query_count?: number
          zero_result_rate?: number | null
        }
        Relationships: []
      }
      search_events: {
        Row: {
          anchor_episode_candidates: number | null
          catalog_anchors: Json
          chunk_augmented_count: number
          confidence_band: string | null
          created_at: string
          degraded_for_latency: boolean | null
          fallback_used: boolean
          id: string
          natural_question: Json | null
          natural_question_fallback: boolean | null
          organization_pin_slug: string | null
          person_pin_slug: string | null
          podcast_pin_slug: string | null
          query: string
          reranked: boolean | null
          result_count: number
          semantic_used: boolean | null
          terms_count: number
          timestamp_match_count: number
          timing: Json | null
          topic_pin_slug: string | null
          user_id: string | null
          viewport_width: number | null
        }
        Insert: {
          anchor_episode_candidates?: number | null
          catalog_anchors?: Json
          chunk_augmented_count?: number
          confidence_band?: string | null
          created_at?: string
          degraded_for_latency?: boolean | null
          fallback_used?: boolean
          id?: string
          natural_question?: Json | null
          natural_question_fallback?: boolean | null
          organization_pin_slug?: string | null
          person_pin_slug?: string | null
          podcast_pin_slug?: string | null
          query: string
          reranked?: boolean | null
          result_count?: number
          semantic_used?: boolean | null
          terms_count?: number
          timestamp_match_count?: number
          timing?: Json | null
          topic_pin_slug?: string | null
          user_id?: string | null
          viewport_width?: number | null
        }
        Update: {
          anchor_episode_candidates?: number | null
          catalog_anchors?: Json
          chunk_augmented_count?: number
          confidence_band?: string | null
          created_at?: string
          degraded_for_latency?: boolean | null
          fallback_used?: boolean
          id?: string
          natural_question?: Json | null
          natural_question_fallback?: boolean | null
          organization_pin_slug?: string | null
          person_pin_slug?: string | null
          podcast_pin_slug?: string | null
          query?: string
          reranked?: boolean | null
          result_count?: number
          semantic_used?: boolean | null
          terms_count?: number
          timestamp_match_count?: number
          timing?: Json | null
          topic_pin_slug?: string | null
          user_id?: string | null
          viewport_width?: number | null
        }
        Relationships: []
      }
      search_golden_queries: {
        Row: {
          active: boolean
          created_at: string
          expected_entity: string | null
          expected_intent: string | null
          expected_podcast_slug: string | null
          id: string
          must_exclude: Json
          must_include: Json
          notes: string | null
          query: string
          query_type: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          expected_entity?: string | null
          expected_intent?: string | null
          expected_podcast_slug?: string | null
          id?: string
          must_exclude?: Json
          must_include?: Json
          notes?: string | null
          query: string
          query_type: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          expected_entity?: string | null
          expected_intent?: string | null
          expected_podcast_slug?: string | null
          id?: string
          must_exclude?: Json
          must_include?: Json
          notes?: string | null
          query?: string
          query_type?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      search_hyde_cache: {
        Row: {
          created_at: string
          embedding: string | null
          hyde_text: string
          q_norm: string
        }
        Insert: {
          created_at?: string
          embedding?: string | null
          hyde_text: string
          q_norm: string
        }
        Update: {
          created_at?: string
          embedding?: string | null
          hyde_text?: string
          q_norm?: string
        }
        Relationships: []
      }
      search_query_cache: {
        Row: {
          created_at: string
          embedding: string | null
          hits: number
          q_norm: string
          rerank: Json | null
          rerank_updated_at: string | null
          understanding: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          embedding?: string | null
          hits?: number
          q_norm: string
          rerank?: Json | null
          rerank_updated_at?: string | null
          understanding?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          embedding?: string | null
          hits?: number
          q_norm?: string
          rerank?: Json | null
          rerank_updated_at?: string | null
          understanding?: Json
          updated_at?: string
        }
        Relationships: []
      }
      search_suggest_cache: {
        Row: {
          created_at: string
          hits: number
          prefix: string
          suggestions: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          hits?: number
          prefix: string
          suggestions?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          hits?: number
          prefix?: string
          suggestions?: Json
          updated_at?: string
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
      social_posts: {
        Row: {
          ai_model: string | null
          bookmarks: number | null
          content: string
          cost_usd: number | null
          created_at: string
          ctr: number | null
          engagement_rate: number | null
          episode_ids: string[]
          error: string | null
          follows: number | null
          hook_type: string | null
          id: string
          impressions: number | null
          likes: number | null
          link_clicks: number | null
          link_placement: string | null
          metadata: Json
          metrics_refreshed_at: string | null
          parent_post_id: string | null
          platform: string
          platform_post_id: string | null
          platform_post_url: string | null
          podcast_ids: string[]
          post_type: string | null
          replies_count: number | null
          reposts: number | null
          score: number | null
          score_breakdown: Json | null
          slot_utc: string | null
          status: string
          trigger: string
        }
        Insert: {
          ai_model?: string | null
          bookmarks?: number | null
          content: string
          cost_usd?: number | null
          created_at?: string
          ctr?: number | null
          engagement_rate?: number | null
          episode_ids?: string[]
          error?: string | null
          follows?: number | null
          hook_type?: string | null
          id?: string
          impressions?: number | null
          likes?: number | null
          link_clicks?: number | null
          link_placement?: string | null
          metadata?: Json
          metrics_refreshed_at?: string | null
          parent_post_id?: string | null
          platform: string
          platform_post_id?: string | null
          platform_post_url?: string | null
          podcast_ids?: string[]
          post_type?: string | null
          replies_count?: number | null
          reposts?: number | null
          score?: number | null
          score_breakdown?: Json | null
          slot_utc?: string | null
          status?: string
          trigger?: string
        }
        Update: {
          ai_model?: string | null
          bookmarks?: number | null
          content?: string
          cost_usd?: number | null
          created_at?: string
          ctr?: number | null
          engagement_rate?: number | null
          episode_ids?: string[]
          error?: string | null
          follows?: number | null
          hook_type?: string | null
          id?: string
          impressions?: number | null
          likes?: number | null
          link_clicks?: number | null
          link_placement?: string | null
          metadata?: Json
          metrics_refreshed_at?: string | null
          parent_post_id?: string | null
          platform?: string
          platform_post_id?: string | null
          platform_post_url?: string | null
          podcast_ids?: string[]
          post_type?: string | null
          replies_count?: number | null
          reposts?: number | null
          score?: number | null
          score_breakdown?: Json | null
          slot_utc?: string | null
          status?: string
          trigger?: string
        }
        Relationships: []
      }
      suggested_taxonomy_items: {
        Row: {
          confidence: number
          created_at: string
          description_hu: string | null
          distinct_podcast_count: number
          episode_count: number
          id: string
          overlap_with_existing_categories: Json
          overlap_with_existing_topics: Json
          reason_hu: string | null
          reviewed_at: string | null
          sample_episode_ids: string[]
          sample_podcast_ids: string[]
          search_demand_score: number
          status: string
          suggested_name_hu: string
          suggested_slug: string
          type: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          description_hu?: string | null
          distinct_podcast_count?: number
          episode_count?: number
          id?: string
          overlap_with_existing_categories?: Json
          overlap_with_existing_topics?: Json
          reason_hu?: string | null
          reviewed_at?: string | null
          sample_episode_ids?: string[]
          sample_podcast_ids?: string[]
          search_demand_score?: number
          status?: string
          suggested_name_hu: string
          suggested_slug: string
          type: string
        }
        Update: {
          confidence?: number
          created_at?: string
          description_hu?: string | null
          distinct_podcast_count?: number
          episode_count?: number
          id?: string
          overlap_with_existing_categories?: Json
          overlap_with_existing_topics?: Json
          reason_hu?: string | null
          reviewed_at?: string | null
          sample_episode_ids?: string[]
          sample_podcast_ids?: string[]
          search_demand_score?: number
          status?: string
          suggested_name_hu?: string
          suggested_slug?: string
          type?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      taste_cards: {
        Row: {
          active: boolean
          archetype_tags: string[]
          card_embedding: string | null
          catalog_fit_score: number | null
          created_at: string
          format_tags: string[]
          hidden_embedding_prompt: string
          id: string
          image_url: string | null
          locale: string
          mood_tags: string[]
          primary_axis: string | null
          priority: number
          psych_tags: string[]
          secondary_axis: string | null
          sensitivity_level: string
          stage: string
          subtitle: string | null
          title: string
          top_episode_similarity: number | null
          topic_tags: string[]
          type: string
          updated_at: string
          validation_status: string
        }
        Insert: {
          active?: boolean
          archetype_tags?: string[]
          card_embedding?: string | null
          catalog_fit_score?: number | null
          created_at?: string
          format_tags?: string[]
          hidden_embedding_prompt: string
          id?: string
          image_url?: string | null
          locale?: string
          mood_tags?: string[]
          primary_axis?: string | null
          priority?: number
          psych_tags?: string[]
          secondary_axis?: string | null
          sensitivity_level?: string
          stage?: string
          subtitle?: string | null
          title: string
          top_episode_similarity?: number | null
          topic_tags?: string[]
          type: string
          updated_at?: string
          validation_status?: string
        }
        Update: {
          active?: boolean
          archetype_tags?: string[]
          card_embedding?: string | null
          catalog_fit_score?: number | null
          created_at?: string
          format_tags?: string[]
          hidden_embedding_prompt?: string
          id?: string
          image_url?: string | null
          locale?: string
          mood_tags?: string[]
          primary_axis?: string | null
          priority?: number
          psych_tags?: string[]
          secondary_axis?: string | null
          sensitivity_level?: string
          stage?: string
          subtitle?: string | null
          title?: string
          top_episode_similarity?: number | null
          topic_tags?: string[]
          type?: string
          updated_at?: string
          validation_status?: string
        }
        Relationships: []
      }
      te_podiverzumod_shares: {
        Row: {
          aura_colors: string[]
          created_at: string
          expires_at: string | null
          id: string
          result_description: string
          result_subtitle: string | null
          result_title: string
          result_type: string
          share_id: string
          source_session_id: string | null
          tags: string[]
          view_count: number
        }
        Insert: {
          aura_colors?: string[]
          created_at?: string
          expires_at?: string | null
          id?: string
          result_description: string
          result_subtitle?: string | null
          result_title: string
          result_type: string
          share_id: string
          source_session_id?: string | null
          tags?: string[]
          view_count?: number
        }
        Update: {
          aura_colors?: string[]
          created_at?: string
          expires_at?: string | null
          id?: string
          result_description?: string
          result_subtitle?: string | null
          result_title?: string
          result_type?: string
          share_id?: string
          source_session_id?: string | null
          tags?: string[]
          view_count?: number
        }
        Relationships: []
      }
      token_df_cache: {
        Row: {
          computed_at: string
          df: number
          token: string
        }
        Insert: {
          computed_at?: string
          df: number
          token: string
        }
        Update: {
          computed_at?: string
          df?: number
          token?: string
        }
        Relationships: []
      }
      topic_aliases: {
        Row: {
          alias: string
          id: string
          normalized_alias: string
          topic_id: string
          weight: number
        }
        Insert: {
          alias: string
          id?: string
          normalized_alias: string
          topic_id: string
          weight?: number
        }
        Update: {
          alias?: string
          id?: string
          normalized_alias?: string
          topic_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "topic_aliases_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_aliases_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "v_canonical_topic_aliases"
            referencedColumns: ["topic_id"]
          },
        ]
      }
      topic_clusters: {
        Row: {
          canonical_label_hu: string
          cluster_method: string
          created_at: string
          description: string | null
          episode_count: number
          id: string
          is_indexable: boolean
          is_public: boolean
          member_labels: string[]
          slug: string
          updated_at: string
        }
        Insert: {
          canonical_label_hu: string
          cluster_method?: string
          created_at?: string
          description?: string | null
          episode_count?: number
          id?: string
          is_indexable?: boolean
          is_public?: boolean
          member_labels?: string[]
          slug: string
          updated_at?: string
        }
        Update: {
          canonical_label_hu?: string
          cluster_method?: string
          created_at?: string
          description?: string | null
          episode_count?: number
          id?: string
          is_indexable?: boolean
          is_public?: boolean
          member_labels?: string[]
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      topic_figure_seed: {
        Row: {
          aliases: string[]
          created_at: string
          id: string
          name: string
          normalized_name: string
          notes: string | null
          origin: string | null
          short_label_hu: string | null
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          id?: string
          name: string
          normalized_name: string
          notes?: string | null
          origin?: string | null
          short_label_hu?: string | null
        }
        Update: {
          aliases?: string[]
          created_at?: string
          id?: string
          name?: string
          normalized_name?: string
          notes?: string | null
          origin?: string | null
          short_label_hu?: string | null
        }
        Relationships: []
      }
      topic_hubs: {
        Row: {
          accent_hsl: string | null
          active: boolean
          aliases: string[]
          appearance_stats: Json
          bio: string | null
          category: string | null
          cost_usd: number | null
          created_at: string
          description: string | null
          episode_ids: string[]
          episodes_summary: string | null
          featured_episode_ids: string[]
          generated_at: string | null
          id: string
          model: string | null
          slug: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          accent_hsl?: string | null
          active?: boolean
          aliases?: string[]
          appearance_stats?: Json
          bio?: string | null
          category?: string | null
          cost_usd?: number | null
          created_at?: string
          description?: string | null
          episode_ids?: string[]
          episodes_summary?: string | null
          featured_episode_ids?: string[]
          generated_at?: string | null
          id?: string
          model?: string | null
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          accent_hsl?: string | null
          active?: boolean
          aliases?: string[]
          appearance_stats?: Json
          bio?: string | null
          category?: string | null
          cost_usd?: number | null
          created_at?: string
          description?: string | null
          episode_ids?: string[]
          episodes_summary?: string | null
          featured_episode_ids?: string[]
          generated_at?: string | null
          id?: string
          model?: string | null
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      topics: {
        Row: {
          created_at: string
          description: string | null
          domain: string | null
          episode_count: number
          h1: string | null
          id: string
          intro_text: string | null
          is_indexable: boolean
          is_public: boolean
          min_evidence_score: number
          name: string
          negative_hints: string[]
          parent_topic_id: string | null
          podcast_count: number
          positive_hints: string[]
          priority: number
          seo_description: string | null
          seo_title: string | null
          short_name: string | null
          slug: string
          sort_order: number
          topic_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          domain?: string | null
          episode_count?: number
          h1?: string | null
          id?: string
          intro_text?: string | null
          is_indexable?: boolean
          is_public?: boolean
          min_evidence_score?: number
          name: string
          negative_hints?: string[]
          parent_topic_id?: string | null
          podcast_count?: number
          positive_hints?: string[]
          priority?: number
          seo_description?: string | null
          seo_title?: string | null
          short_name?: string | null
          slug: string
          sort_order?: number
          topic_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          domain?: string | null
          episode_count?: number
          h1?: string | null
          id?: string
          intro_text?: string | null
          is_indexable?: boolean
          is_public?: boolean
          min_evidence_score?: number
          name?: string
          negative_hints?: string[]
          parent_topic_id?: string | null
          podcast_count?: number
          positive_hints?: string[]
          priority?: number
          seo_description?: string | null
          seo_title?: string | null
          short_name?: string | null
          slug?: string
          sort_order?: number
          topic_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topics_parent_topic_id_fkey"
            columns: ["parent_topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topics_parent_topic_id_fkey"
            columns: ["parent_topic_id"]
            isOneToOne: false
            referencedRelation: "v_canonical_topic_aliases"
            referencedColumns: ["topic_id"]
          },
        ]
      }
      user_episode_interactions: {
        Row: {
          created_at: string
          episode_id: string
          id: string
          kind: string
          source: string | null
          user_id: string
          weight: number
        }
        Insert: {
          created_at?: string
          episode_id: string
          id?: string
          kind: string
          source?: string | null
          user_id: string
          weight: number
        }
        Update: {
          created_at?: string
          episode_id?: string
          id?: string
          kind?: string
          source?: string | null
          user_id?: string
          weight?: number
        }
        Relationships: []
      }
      user_episode_marks: {
        Row: {
          created_at: string
          episode_id: string
          id: string
          mark_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          episode_id: string
          id?: string
          mark_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          episode_id?: string
          id?: string
          mark_type?: string
          user_id?: string
        }
        Relationships: []
      }
      user_listen_history: {
        Row: {
          episode_id: string
          id: string
          played_at: string
          progress_seconds: number
          user_id: string
        }
        Insert: {
          episode_id: string
          id?: string
          played_at?: string
          progress_seconds?: number
          user_id: string
        }
        Update: {
          episode_id?: string
          id?: string
          played_at?: string
          progress_seconds?: number
          user_id?: string
        }
        Relationships: []
      }
      user_podcast_follows: {
        Row: {
          created_at: string
          id: string
          last_notified_at: string | null
          podcast_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_notified_at?: string | null
          podcast_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_notified_at?: string | null
          podcast_id?: string
          user_id?: string
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
      watchdog_events: {
        Row: {
          auto_paused: boolean
          created_at: string
          detail: Json
          dry_run: boolean
          id: string
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          resolved_note: string | null
          rule: string
          runner: string
          severity: string
        }
        Insert: {
          auto_paused?: boolean
          created_at?: string
          detail?: Json
          dry_run?: boolean
          id?: string
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_note?: string | null
          rule: string
          runner: string
          severity: string
        }
        Update: {
          auto_paused?: boolean
          created_at?: string
          detail?: Json
          dry_run?: boolean
          id?: string
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_note?: string | null
          rule?: string
          runner?: string
          severity?: string
        }
        Relationships: []
      }
      youtube_channel_stats: {
        Row: {
          channel_id: string
          created_at: string
          id: string
          snapshot_at: string
          subscriber_count: number | null
          video_count: number | null
          view_count: number | null
        }
        Insert: {
          channel_id: string
          created_at?: string
          id?: string
          snapshot_at?: string
          subscriber_count?: number | null
          video_count?: number | null
          view_count?: number | null
        }
        Update: {
          channel_id?: string
          created_at?: string
          id?: string
          snapshot_at?: string
          subscriber_count?: number | null
          video_count?: number | null
          view_count?: number | null
        }
        Relationships: []
      }
      youtube_transcript_attempts: {
        Row: {
          attempted_at: string
          cost_usd: number
          episode_id: string
          error_message: string | null
          match_policy: string
          match_score: number | null
          podcast_id: string
          status: string
          transcript_chars: number | null
          updated_at: string
          youtube_video_id: string
        }
        Insert: {
          attempted_at?: string
          cost_usd?: number
          episode_id: string
          error_message?: string | null
          match_policy?: string
          match_score?: number | null
          podcast_id: string
          status: string
          transcript_chars?: number | null
          updated_at?: string
          youtube_video_id: string
        }
        Update: {
          attempted_at?: string
          cost_usd?: number
          episode_id?: string
          error_message?: string | null
          match_policy?: string
          match_score?: number | null
          podcast_id?: string
          status?: string
          transcript_chars?: number | null
          updated_at?: string
          youtube_video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "youtube_transcript_attempts_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "youtube_transcript_attempts_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "youtube_transcript_attempts_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "youtube_transcript_attempts_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_data_quality_issues"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "youtube_transcript_attempts_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "v_episode_quality_indicator_audit"
            referencedColumns: ["episode_id"]
          },
          {
            foreignKeyName: "youtube_transcript_attempts_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "youtube_transcript_attempts_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "youtube_transcript_attempts_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "youtube_transcript_attempts_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_hu_archive_completeness"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "youtube_transcript_attempts_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_youtube_native_transcript_candidates"
            referencedColumns: ["podcast_id"]
          },
        ]
      }
    }
    Views: {
      mv_homepage_evergreen: {
        Row: {
          ai_summary: string | null
          audio_url: string | null
          description: string | null
          display_title: string | null
          episode_id: string | null
          featured: boolean | null
          pod_rank: number | null
          podcast_category: string | null
          podcast_display_title: string | null
          podcast_id: string | null
          podcast_image_url: string | null
          podcast_slug: string | null
          podcast_title: string | null
          podiverzum_rank: number | null
          published_at: string | null
          rank_label: string | null
          rss_status: string | null
          slug: string | null
          summary: string | null
          title: string | null
          topics: string[] | null
          youtube_view_count: number | null
        }
        Relationships: []
      }
      mv_homepage_feed: {
        Row: {
          audio_url: string | null
          description: string | null
          display_title: string | null
          episode_id: string | null
          featured: boolean | null
          featured_rank: number | null
          freshness_bucket: string | null
          pod_rank: number | null
          podcast_category: string | null
          podcast_display_title: string | null
          podcast_id: string | null
          podcast_image_url: string | null
          podcast_slug: string | null
          podcast_title: string | null
          podiverzum_rank: number | null
          published_at: string | null
          rank_label: string | null
          rss_status: string | null
          slug: string | null
          summary: string | null
          title: string | null
          topics: string[] | null
        }
        Relationships: []
      }
      person_activation_status_view: {
        Row: {
          activation_reason: string | null
          activation_status: string | null
          ai_recommended_action: string | null
          ai_review_status: string | null
          confidence: number | null
          distinct_podcast_count: number | null
          episode_count: number | null
          guest_count: number | null
          host_count: number | null
          id: string | null
          is_indexable: boolean | null
          is_public: boolean | null
          latest_episode_at: string | null
          mentioned_count: number | null
          name: string | null
          slug: string | null
          strong_mention_count: number | null
          subject_count: number | null
          wikipedia_match_status: string | null
        }
        Insert: {
          activation_reason?: string | null
          activation_status?: string | null
          ai_recommended_action?: string | null
          ai_review_status?: string | null
          confidence?: number | null
          distinct_podcast_count?: number | null
          episode_count?: number | null
          guest_count?: number | null
          host_count?: number | null
          id?: string | null
          is_indexable?: boolean | null
          is_public?: boolean | null
          latest_episode_at?: string | null
          mentioned_count?: number | null
          name?: string | null
          slug?: string | null
          strong_mention_count?: number | null
          subject_count?: number | null
          wikipedia_match_status?: string | null
        }
        Update: {
          activation_reason?: string | null
          activation_status?: string | null
          ai_recommended_action?: string | null
          ai_review_status?: string | null
          confidence?: number | null
          distinct_podcast_count?: number | null
          episode_count?: number | null
          guest_count?: number | null
          host_count?: number | null
          id?: string | null
          is_indexable?: boolean | null
          is_public?: boolean | null
          latest_episode_at?: string | null
          mentioned_count?: number | null
          name?: string | null
          slug?: string | null
          strong_mention_count?: number | null
          subject_count?: number | null
          wikipedia_match_status?: string | null
        }
        Relationships: []
      }
      person_ai_action_queue_view: {
        Row: {
          activation_status: string | null
          ai_recommended_action: string | null
          ai_review_confidence: number | null
          ai_review_flags: string[] | null
          ai_review_status: string | null
          ai_review_summary: string | null
          distinct_podcast_count: number | null
          episode_count: number | null
          id: string | null
          name: string | null
          slug: string | null
          strong_mention_count: number | null
        }
        Insert: {
          activation_status?: string | null
          ai_recommended_action?: string | null
          ai_review_confidence?: number | null
          ai_review_flags?: string[] | null
          ai_review_status?: string | null
          ai_review_summary?: string | null
          distinct_podcast_count?: number | null
          episode_count?: number | null
          id?: string | null
          name?: string | null
          slug?: string | null
          strong_mention_count?: number | null
        }
        Update: {
          activation_status?: string | null
          ai_recommended_action?: string | null
          ai_review_confidence?: number | null
          ai_review_flags?: string[] | null
          ai_review_status?: string | null
          ai_review_summary?: string | null
          distinct_podcast_count?: number | null
          episode_count?: number | null
          id?: string | null
          name?: string | null
          slug?: string | null
          strong_mention_count?: number | null
        }
        Relationships: []
      }
      person_ai_duplicate_candidates_view: {
        Row: {
          ai_duplicate_of_person_id: string | null
          ai_review_confidence: number | null
          ai_review_summary: string | null
          id: string | null
          name: string | null
          slug: string | null
        }
        Insert: {
          ai_duplicate_of_person_id?: string | null
          ai_review_confidence?: number | null
          ai_review_summary?: string | null
          id?: string | null
          name?: string | null
          slug?: string | null
        }
        Update: {
          ai_duplicate_of_person_id?: string | null
          ai_review_confidence?: number | null
          ai_review_summary?: string | null
          id?: string | null
          name?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      person_ai_review_summary_view: {
        Row: {
          duplicate_candidates: number | null
          needs_human_review: number | null
          pending: number | null
          recommended_hide: number | null
          recommended_keep_indexable: number | null
          recommended_merge: number | null
          recommended_needs_review: number | null
          recommended_noindex: number | null
          recommended_reject: number | null
          reviewed: number | null
          total: number | null
        }
        Relationships: []
      }
      person_missing_content_review_view: {
        Row: {
          activation_status: string | null
          ai_bio_status: string | null
          distinct_podcast_count: number | null
          editorial_priority: boolean | null
          episode_count: number | null
          guest_count: number | null
          has_ai_bio: boolean | null
          has_overview_text: boolean | null
          host_count: number | null
          is_browsable_in_people_hub: boolean | null
          is_indexable: boolean | null
          is_public: boolean | null
          manually_seeded: boolean | null
          mapped_podcasts: string[] | null
          mentioned_count: number | null
          missing_reason: string | null
          name: string | null
          person_id: string | null
          recommended_action: string | null
          sample_episode_titles: string[] | null
          slug: string | null
          strong_mention_count: number | null
          subject_count: number | null
          wikipedia_match_status: string | null
        }
        Insert: {
          activation_status?: string | null
          ai_bio_status?: string | null
          distinct_podcast_count?: number | null
          editorial_priority?: boolean | null
          episode_count?: number | null
          guest_count?: number | null
          has_ai_bio?: never
          has_overview_text?: never
          host_count?: number | null
          is_browsable_in_people_hub?: boolean | null
          is_indexable?: boolean | null
          is_public?: boolean | null
          manually_seeded?: boolean | null
          mapped_podcasts?: never
          mentioned_count?: number | null
          missing_reason?: never
          name?: string | null
          person_id?: string | null
          recommended_action?: never
          sample_episode_titles?: never
          slug?: string | null
          strong_mention_count?: number | null
          subject_count?: number | null
          wikipedia_match_status?: string | null
        }
        Update: {
          activation_status?: string | null
          ai_bio_status?: string | null
          distinct_podcast_count?: number | null
          editorial_priority?: boolean | null
          episode_count?: number | null
          guest_count?: number | null
          has_ai_bio?: never
          has_overview_text?: never
          host_count?: number | null
          is_browsable_in_people_hub?: boolean | null
          is_indexable?: boolean | null
          is_public?: boolean | null
          manually_seeded?: boolean | null
          mapped_podcasts?: never
          mentioned_count?: number | null
          missing_reason?: never
          name?: string | null
          person_id?: string | null
          recommended_action?: never
          sample_episode_titles?: never
          slug?: string | null
          strong_mention_count?: number | null
          subject_count?: number | null
          wikipedia_match_status?: string | null
        }
        Relationships: []
      }
      reddit_name_index: {
        Row: {
          entity_id: string | null
          kind: string | null
          name: string | null
          norm_name: string | null
          path: string | null
          rank_label: string | null
          weight: number | null
        }
        Relationships: []
      }
      te_podiverzumod_shares_public: {
        Row: {
          aura_colors: string[] | null
          created_at: string | null
          expires_at: string | null
          result_description: string | null
          result_subtitle: string | null
          result_title: string | null
          result_type: string | null
          share_id: string | null
          tags: string[] | null
        }
        Insert: {
          aura_colors?: string[] | null
          created_at?: string | null
          expires_at?: string | null
          result_description?: string | null
          result_subtitle?: string | null
          result_title?: string | null
          result_type?: string | null
          share_id?: string | null
          tags?: string[] | null
        }
        Update: {
          aura_colors?: string[] | null
          created_at?: string | null
          expires_at?: string | null
          result_description?: string | null
          result_subtitle?: string | null
          result_title?: string | null
          result_type?: string | null
          share_id?: string | null
          tags?: string[] | null
        }
        Relationships: []
      }
      v_canonical_topic_aliases: {
        Row: {
          alias: string | null
          canonical_name: string | null
          canonical_slug: string | null
          domain: string | null
          normalized_alias: string | null
          source: string | null
          topic_id: string | null
          updated_at: string | null
          weight: number | null
        }
        Relationships: []
      }
      v_data_repair_queue: {
        Row: {
          action_order: number | null
          display_title: string | null
          episode_id: string | null
          issue_codes: string[] | null
          may_require_ai: boolean | null
          podcast_display_title: string | null
          podcast_id: string | null
          podcast_title: string | null
          podiverzum_rank: number | null
          priority_score: number | null
          published_at: string | null
          rank_label: string | null
          repair_action: string | null
          safety_policy: string | null
          title: string | null
        }
        Relationships: []
      }
      v_entity_quality_issues: {
        Row: {
          ai_review_score: number | null
          ai_review_status: string | null
          distinct_podcast_count: number | null
          entity_id: string | null
          entity_kind: string | null
          entity_type: string | null
          episode_count: number | null
          is_browsable_in_hub: boolean | null
          is_indexable: boolean | null
          is_public: boolean | null
          issue_codes: string[] | null
          may_require_ai: boolean | null
          mention_count: number | null
          name: string | null
          priority_score: number | null
          repair_action: string | null
          safety_policy: string | null
          slug: string | null
        }
        Relationships: []
      }
      v_episode_data_quality_issues: {
        Row: {
          clean_length: number | null
          clean_source_hash: string | null
          clean_updated_at: string | null
          cleaner_method: string | null
          display_title: string | null
          embedding_updated_at: string | null
          entity_signal_count: number | null
          episode_id: string | null
          issue_codes: string[] | null
          issue_count: number | null
          podcast_display_title: string | null
          podcast_id: string | null
          podcast_title: string | null
          podiverzum_rank: number | null
          priority_score: number | null
          published_at: string | null
          rank_label: string | null
          raw_length: number | null
          retention_ratio: number | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "episodes_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "episodes_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "episodes_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episodes_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_hu_archive_completeness"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "episodes_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_youtube_native_transcript_candidates"
            referencedColumns: ["podcast_id"]
          },
        ]
      }
      v_episode_quality_indicator_audit: {
        Row: {
          audio_url: string | null
          computed_episode_score: number | null
          data_issue_codes: string[] | null
          data_issue_count: number | null
          display_title: string | null
          displayed_quality_score: number | null
          episode_id: string | null
          legacy_episode_rank: number | null
          legacy_episode_rank_label: string | null
          legacy_episode_rank_reason: Json | null
          legacy_episode_rank_updated_at: string | null
          podcast_display_title: string | null
          podcast_id: string | null
          podcast_title: string | null
          podiverzum_rank: number | null
          published_at: string | null
          quality_issue_codes: string[] | null
          quality_issue_count: number | null
          quality_priority_score: number | null
          rank_label: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "episodes_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_evergreen"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "episodes_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "mv_homepage_feed"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "episodes_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "podcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "episodes_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_hu_archive_completeness"
            referencedColumns: ["podcast_id"]
          },
          {
            foreignKeyName: "episodes_podcast_id_fkey"
            columns: ["podcast_id"]
            isOneToOne: false
            referencedRelation: "v_youtube_native_transcript_candidates"
            referencedColumns: ["podcast_id"]
          },
        ]
      }
      v_hu_archive_completeness: {
        Row: {
          episode_count: number | null
          full_backfill_completed_at: string | null
          hydrated_episode_count: number | null
          last_fetched_at: string | null
          latest_episode_at: string | null
          oldest_episode_at: string | null
          pass_status: string | null
          pi_backfill_approved: boolean | null
          pi_backfill_completed_at: string | null
          pi_backfill_episode_count: number | null
          pi_gap: number | null
          podcast_id: string | null
          podiverzum_rank: number | null
          rank_label: string | null
          rss_status: string | null
          rss_url: string | null
          slug: string | null
          title: string | null
        }
        Relationships: []
      }
      v_person_collision_buckets: {
        Row: {
          any_ambiguous: boolean | null
          any_duplicate: boolean | null
          avg_risk: number | null
          existing_labels: string[] | null
          max_risk: number | null
          normalized_name: string | null
          person_ids: string[] | null
          row_count: number | null
          total_eps: number | null
          total_pods: number | null
        }
        Relationships: []
      }
      v_person_diag_alias_review_queue: {
        Row: {
          alias: string | null
          confidence: number | null
          created_at: string | null
          id: string | null
          normalized_alias: string | null
          on_surname_watchlist: boolean | null
          person_id: string | null
          person_name: string | null
          person_slug: string | null
          review_reason: string | null
          reviewed_at: string | null
          scope: string | null
          source: string | null
          status: string | null
          token_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_activation_status_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_ai_action_queue_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_ai_duplicate_candidates_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "person_missing_content_review_view"
            referencedColumns: ["person_id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_duplicate_clusters"
            referencedColumns: ["person_a_id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_duplicate_clusters"
            referencedColumns: ["person_b_id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_high_reject_ratio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_pending_backlog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_surname_only_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_aliases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "v_person_diag_weak_public_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      v_person_diag_duplicate_clusters: {
        Row: {
          a_eps: number | null
          a_indexable: boolean | null
          a_public: boolean | null
          b_eps: number | null
          b_indexable: boolean | null
          b_public: boolean | null
          person_a_id: string | null
          person_a_name: string | null
          person_a_slug: string | null
          person_b_id: string | null
          person_b_name: string | null
          person_b_slug: string | null
          sim: number | null
        }
        Relationships: []
      }
      v_person_diag_high_reject_ratio: {
        Row: {
          accepted_cnt: number | null
          gated_episode_count: number | null
          id: string | null
          is_indexable: boolean | null
          is_public: boolean | null
          name: string | null
          needs_review_cnt: number | null
          pending_cnt: number | null
          reject_ratio: number | null
          rejected_cnt: number | null
          slug: string | null
          total_cnt: number | null
        }
        Relationships: []
      }
      v_person_diag_pending_backlog: {
        Row: {
          id: string | null
          is_indexable: boolean | null
          is_public: boolean | null
          name: string | null
          needs_review_cnt: number | null
          pending_cnt: number | null
          slug: string | null
          total_mentions: number | null
        }
        Relationships: []
      }
      v_person_diag_surname_only_candidates: {
        Row: {
          confidence: number | null
          gated_episode_count: number | null
          gated_podcast_count: number | null
          id: string | null
          identity_status: string | null
          is_browsable_in_people_hub: boolean | null
          is_indexable: boolean | null
          is_public: boolean | null
          name: string | null
          on_watchlist: boolean | null
          risk_level: string | null
          slug: string | null
          token_count: number | null
        }
        Insert: {
          confidence?: number | null
          gated_episode_count?: number | null
          gated_podcast_count?: number | null
          id?: string | null
          identity_status?: string | null
          is_browsable_in_people_hub?: boolean | null
          is_indexable?: boolean | null
          is_public?: boolean | null
          name?: string | null
          on_watchlist?: never
          risk_level?: never
          slug?: string | null
          token_count?: never
        }
        Update: {
          confidence?: number | null
          gated_episode_count?: number | null
          gated_podcast_count?: number | null
          id?: string | null
          identity_status?: string | null
          is_browsable_in_people_hub?: boolean | null
          is_indexable?: boolean | null
          is_public?: boolean | null
          name?: string | null
          on_watchlist?: never
          risk_level?: never
          slug?: string | null
          token_count?: never
        }
        Relationships: []
      }
      v_person_diag_weak_public_pages: {
        Row: {
          accepted_cnt: number | null
          confidence: number | null
          gated_episode_count: number | null
          gated_podcast_count: number | null
          id: string | null
          is_browsable_in_people_hub: boolean | null
          is_indexable: boolean | null
          is_public: boolean | null
          name: string | null
          pending_cnt: number | null
          slug: string | null
        }
        Relationships: []
      }
      v_youtube_native_transcript_candidates: {
        Row: {
          confirmed_youtube_episodes: number | null
          last_caption_check_at: string | null
          native_transcript_untried_episodes: number | null
          podcast_id: string | null
          podcast_title: string | null
          stored_transcript_episodes: number | null
          youtube_caption_available_episodes: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_ai_spend: {
        Args: {
          p_amount: number
          p_calls?: number
          p_day: string
          p_kind: string
        }
        Returns: undefined
      }
      admin_person_missing_content: {
        Args: { p_limit?: number }
        Returns: {
          activation_status: string | null
          ai_bio_status: string | null
          distinct_podcast_count: number | null
          editorial_priority: boolean | null
          episode_count: number | null
          guest_count: number | null
          has_ai_bio: boolean | null
          has_overview_text: boolean | null
          host_count: number | null
          is_browsable_in_people_hub: boolean | null
          is_indexable: boolean | null
          is_public: boolean | null
          manually_seeded: boolean | null
          mapped_podcasts: string[] | null
          mentioned_count: number | null
          missing_reason: string | null
          name: string | null
          person_id: string | null
          recommended_action: string | null
          sample_episode_titles: string[] | null
          slug: string | null
          strong_mention_count: number | null
          subject_count: number | null
          wikipedia_match_status: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "person_missing_content_review_view"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      backfill_mentions_from_people_array: {
        Args: { p_dry_run?: boolean; p_person_ids?: string[] }
        Returns: {
          inserted_count: number
          person_count: number
          sample: Json
        }[]
      }
      canonical_alias_backfill_apply: {
        Args: { p_dry?: boolean; p_kinds?: string[] }
        Returns: {
          collisions: number
          entity_kind: string
          noop: number
          renamed: number
        }[]
      }
      canonical_alias_backfill_dryrun: {
        Args: { p_kinds?: string[] }
        Returns: {
          entity_kind: string
          sample: Json
          total_rows: number
          would_collide: number
          would_rename: number
        }[]
      }
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
      claim_ai_jobs_by_kind: {
        Args: { _kind: string; _limit: number; _lock_seconds?: number }
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
      claim_person_judge_batch: { Args: { _limit: number }; Returns: string[] }
      clean_slug: { Args: { fallback: string; input: string }; Returns: string }
      cron_revert_title_cleanup: { Args: never; Returns: undefined }
      dedup_episodes_audio_url_batch: {
        Args: { _batch?: number }
        Returns: number
      }
      dedup_episodes_guid_batch: { Args: { _batch?: number }; Returns: number }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_my_account: { Args: never; Returns: undefined }
      demote_publisher_self_orgs: {
        Args: never
        Returns: {
          demoted_count: number
        }[]
      }
      embed_candidate_stats: {
        Args: { _model: string; _tiers: string[] }
        Returns: Json
      }
      embed_chunks_candidate_stats: { Args: { _model: string }; Returns: Json }
      embed_episode_candidate_stats: { Args: { _model: string }; Returns: Json }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      episode_classifier_stats: { Args: never; Returns: Json }
      find_existing_podcast: {
        Args: { p_rss_url: string; p_title: string }
        Returns: string
      }
      formula_c_candidates: {
        Args: { _limit?: number }
        Returns: {
          id: string
        }[]
      }
      formula_c_status: { Args: never; Returns: Json }
      get_active_taste_cards: {
        Args: { p_limit?: number }
        Returns: {
          archetype_tags: string[]
          card_embedding: string
          catalog_fit_score: number
          format_tags: string[]
          id: string
          image_url: string
          mood_tags: string[]
          priority: number
          psych_tags: string[]
          sensitivity_level: string
          stage: string
          subtitle: string
          title: string
          top_episode_similarity: number
          topic_tags: string[]
        }[]
      }
      get_cron_health: { Args: never; Returns: Json }
      get_data_quality_snapshot_v1: {
        Args: { _recent_days?: number; _sample_limit?: number }
        Returns: Json
      }
      get_data_repair_plan_v1: {
        Args: { _include_ai?: boolean; _limit?: number; _recent_days?: number }
        Returns: Json
      }
      get_entity_quality_snapshot_v1: {
        Args: { _limit?: number }
        Returns: Json
      }
      get_homepage_rails_v1: {
        Args: {
          _category_limit?: number
          _evergreen_limit?: number
          _max_categories?: number
          _trending_limit?: number
        }
        Returns: Json
      }
      get_homepage_rails_with_images_v1: {
        Args: {
          _category_limit?: number
          _evergreen_limit?: number
          _max_categories?: number
          _trending_limit?: number
        }
        Returns: Json
      }
      get_mood_episode_recommendations: {
        Args: { p_exclude?: string[]; p_limit?: number; p_mood_slug: string }
        Returns: {
          ai_summary: string
          audio_url: string
          description: string
          display_title: string
          episode_id: string
          final_score: number
          image_url: string
          podcast_category: string
          podcast_display_title: string
          podcast_id: string
          podcast_image_url: string
          podcast_slug: string
          podcast_title: string
          podiverzum_rank: number
          published_at: string
          rank_label: string
          similarity: number
          slug: string
          summary: string
          title: string
          topics: string[]
        }[]
      }
      get_ops_dashboard_status: { Args: never; Returns: Json }
      get_personalized_mood_cards: {
        Args: { p_dow?: number; p_hour?: number; p_viewport?: string }
        Returns: {
          description: string
          energy_level: string
          href: string
          reason_label: string
          representative_episode_count: number
          short_description: string
          slug: string
          sort_order: number
          title: string
        }[]
      }
      get_pipeline_health_snapshot_v1: { Args: never; Returns: Json }
      get_related_episodes_by_embedding: {
        Args: {
          p_downweight_same_podcast?: boolean
          p_episode_id: string
          p_limit?: number
        }
        Returns: {
          ai_summary: string
          audio_url: string
          description: string
          display_title: string
          episode_id: string
          final_score: number
          image_url: string
          podcast_category: string
          podcast_display_title: string
          podcast_id: string
          podcast_image_url: string
          podcast_slug: string
          podcast_title: string
          podiverzum_rank: number
          published_at: string
          rank_label: string
          related_reason: string
          similarity: number
          slug: string
          summary: string
          title: string
          topics: string[]
        }[]
      }
      get_similar_podcasts_by_embedding: {
        Args: { p_limit?: number; p_podcast_id: string }
        Returns: {
          apple_url: string
          category: string
          description: string
          display_title: string
          episode_count: number
          featured: boolean
          final_score: number
          id: string
          image_url: string
          latest_episode_at: string
          podiverzum_rank: number
          rank_label: string
          rss_status: string
          similarity: number
          slug: string
          spotify_url: string
          summary: string
          title: string
          website_url: string
          youtube_url: string
        }[]
      }
      get_swipe_seed_episodes: {
        Args: { p_limit?: number }
        Returns: {
          ai_summary: string
          display_title: string
          episode_id: string
          image_url: string
          podcast_id: string
          podcast_image_url: string
          podcast_slug: string
          podcast_title: string
          slug: string
          title: string
        }[]
      }
      get_swipe_seed_from_anchors:
        | {
            Args: {
              p_keywords?: string[]
              p_limit?: number
              p_person_ids?: string[]
              p_podcast_ids?: string[]
            }
            Returns: {
              ai_summary: string
              anchor_kind: string
              display_title: string
              episode_id: string
              image_url: string
              podcast_id: string
              podcast_image_url: string
              podcast_slug: string
              podcast_title: string
              slug: string
              title: string
            }[]
          }
        | {
            Args: {
              p_limit?: number
              p_person_ids?: string[]
              p_podcast_ids?: string[]
            }
            Returns: {
              ai_summary: string
              anchor_kind: string
              display_title: string
              episode_id: string
              image_url: string
              podcast_id: string
              podcast_image_url: string
              podcast_slug: string
              podcast_title: string
              slug: string
              title: string
            }[]
          }
      get_trending_podcasts: {
        Args: { p_limit?: number }
        Returns: {
          apple_url: string
          category: string
          description: string
          display_title: string
          id: string
          image_url: string
          podiverzum_rank: number
          rank_label: string
          slug: string
          snapshot_at: string
          sources: Json
          spotify_url: string
          summary: string
          title: string
          trending_score: number
          website_url: string
          youtube_url: string
        }[]
      }
      get_youtube_native_transcript_candidate_summary_v1: {
        Args: { limit_count?: number }
        Returns: {
          caption_coverage: number
          confirmed_youtube_episodes: number
          last_caption_check_at: string
          native_transcript_untried_episodes: number
          podcast_id: string
          podcast_title: string
          stored_transcript_episodes: number
          youtube_caption_available_episodes: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hu_chart_freshness: {
        Args: never
        Returns: {
          days_old: number
          latest_snapshot: string
          rows_in_latest: number
          source: string
          stale: boolean
        }[]
      }
      hu_content_intelligence_v2: {
        Args: { _ids: string[] }
        Returns: {
          audio_coverage: number
          avg_description_len: number
          entity_coverage: number
          episode_count: number
          podcast_id: string
          recent_episode_count: number
          summary_coverage: number
          topic_coverage: number
        }[]
      }
      hu_market_popularity: {
        Args: never
        Returns: {
          podcast_id: string
          rrf_score: number
          source_count: number
          sources: Json
        }[]
      }
      hu_recent_activity: {
        Args: { _ids: string[] }
        Returns: {
          avg_ep_title_len: number
          eps_180d: number
          eps_90d: number
          last_ep_at: string
          podcast_id: string
        }[]
      }
      immutable_unaccent: { Args: { s: string }; Returns: string }
      is_hungarianish_public_ai_text: {
        Args: { _text: string }
        Returns: boolean
      }
      is_publicly_visible_hu_podcast: {
        Args: { p_id: string }
        Returns: boolean
      }
      list_people_alpha: {
        Args: { p_letter?: string; p_limit?: number; p_offset?: number }
        Returns: {
          ai_bio: string
          ai_bio_confidence: number
          ai_bio_status: string
          disambiguation_label: string
          episode_count: number
          gated_episode_count: number
          gated_podcast_count: number
          guest_count: number
          host_count: number
          id: string
          identity_ambiguous: boolean
          image_url: string
          latest_accepted_relevant_episode_at: string
          manual_approved: boolean
          name: string
          podcast_count: number
          short_bio: string
          slug: string
          strong_mention_count: number
          total_count: number
          wikipedia_match_confidence: number
          wikipedia_match_status: string
        }[]
      }
      list_people_hub: {
        Args: { p_limit?: number; p_offset?: number; p_search?: string }
        Returns: {
          ai_bio: string
          ai_bio_confidence: number
          ai_bio_status: string
          disambiguation_label: string
          distinct_podcast_count: number
          episode_count: number
          gated_episode_count: number
          gated_podcast_count: number
          guest_count: number
          host_count: number
          id: string
          identity_ambiguous: boolean
          image_url: string
          latest_accepted_relevant_episode_at: string
          manual_approved: boolean
          name: string
          people_hub_score: number
          podcast_count: number
          recent_relevant_episode_count_30d: number
          short_bio: string
          slug: string
          strong_mention_count: number
          total_count: number
          wikipedia_match_confidence: number
          wikipedia_match_status: string
        }[]
      }
      match_episodes_by_centroid: {
        Args: { p_disliked?: string[]; p_liked: string[]; p_limit?: number }
        Returns: {
          ai_summary: string
          display_title: string
          episode_id: string
          image_url: string
          podcast_id: string
          podcast_image_url: string
          podcast_slug: string
          podcast_title: string
          similarity: number
          slug: string
          title: string
        }[]
      }
      match_episodes_by_taste_vector: {
        Args: {
          p_exclude_episode_ids?: string[]
          p_limit?: number
          p_negative_vector?: string
          p_user_vector: string
        }
        Returns: {
          ai_summary: string
          category: string
          display_title: string
          episode_id: string
          final_score: number
          image_url: string
          podcast_id: string
          podcast_image_url: string
          podcast_slug: string
          podcast_title: string
          published_at: string
          similarity: number
          slug: string
          title: string
          topics: string[]
        }[]
      }
      match_episodes_by_user_history: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          ai_summary: string
          display_title: string
          episode_id: string
          image_url: string
          podcast_id: string
          podcast_image_url: string
          podcast_slug: string
          podcast_title: string
          similarity: number
          slug: string
          title: string
        }[]
      }
      match_hu_episodes_by_embedding: {
        Args: {
          match_count?: number
          min_similarity?: number
          query_embedding: string
        }
        Returns: {
          episode_id: string
          podcast_id: string
          similarity: number
        }[]
      }
      match_org_by_name: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          gated_episode_count: number
          id: string
          name: string
          org_type: string
          slug: string
          wikipedia_match_status: string
        }[]
      }
      match_podcast_by_name: {
        Args: { p_max?: number; p_q: string; p_threshold?: number }
        Returns: {
          match_type: string
          podcast_id: string
          similarity: number
          slug: string
          title: string
        }[]
      }
      match_podcasts_by_embedding: {
        Args: {
          p_embedding: string
          p_lang?: string
          p_limit?: number
          p_model?: string
        }
        Returns: {
          category: string
          display_title: string
          id: string
          image_url: string
          podiverzum_rank: number
          shadow_rank_tier: string
          similarity: number
          slug: string
          title: string
        }[]
      }
      match_user_episodes: {
        Args: { p_freshness_days?: number; p_limit?: number; p_user: string }
        Returns: {
          episode_id: string
          podcast_id: string
          similarity: number
        }[]
      }
      merge_ai_spend: {
        Args: {
          p_calls?: number
          p_day: string
          p_delta: Json
          p_total_amount?: number
        }
        Returns: undefined
      }
      merge_duplicate_podcasts: {
        Args: { _canonical_id: string; _duplicate_id: string; _reason?: string }
        Returns: Json
      }
      merge_organizations: {
        Args: { p_dst: string; p_note?: string; p_src: string }
        Returns: Json
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      normalize_entity_alias: { Args: { input: string }; Returns: string }
      normalize_podcast_title: { Args: { s: string }; Returns: string }
      normalize_rss_url: { Args: { _url: string }; Returns: string }
      pending_youtube_transcript_candidates: {
        Args: {
          p_limit?: number
          p_min_match_score?: number
          p_require_caption?: boolean
        }
        Returns: {
          episode_id: string
          match_score: number
          podcast_id: string
          validation_reason: Json
          youtube_caption_available: boolean
          youtube_description: string
          youtube_duration_seconds: number
          youtube_video_id: string
        }[]
      }
      people_alpha_letter_counts: {
        Args: never
        Returns: {
          count: number
          letter: string
        }[]
      }
      pipeline_health_item_v1: {
        Args: {
          p_backlog?: number
          p_backlog_label?: string
          p_controls_key: string
          p_cron_pattern: string
          p_name: string
          p_progress_key: string
        }
        Returns: Json
      }
      purge_search_query_cache: {
        Args: { older_than_days?: number }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reap_ai_stale_locks: {
        Args: { _older_than_minutes?: number }
        Returns: number
      }
      reap_deep_hydration_stale: {
        Args: { _older_than_minutes?: number }
        Returns: number
      }
      recommendation_has_content_bridge: {
        Args: {
          p_candidate_companies: string[]
          p_candidate_people: string[]
          p_candidate_topics: string[]
          p_source_companies: string[]
          p_source_people: string[]
          p_source_topics: string[]
        }
        Returns: boolean
      }
      recommendation_has_topic_bridge: {
        Args: { p_candidate_topics: string[]; p_source_topics: string[] }
        Returns: boolean
      }
      recommendation_is_compatible: {
        Args: {
          p_candidate_group: string
          p_has_topic_bridge: boolean
          p_similarity: number
          p_source_group: string
        }
        Returns: boolean
      }
      recommendation_text_group: {
        Args: {
          p_category: string
          p_podcast_title: string
          p_title: string
          p_topics: string[]
        }
        Returns: string
      }
      recompute_mood_recommended_counts: {
        Args: never
        Returns: {
          count: number
          mood_slug: string
          weak: boolean
        }[]
      }
      recompute_org_gated_counts: { Args: never; Returns: undefined }
      recompute_person_archival_evidence: { Args: never; Returns: number }
      recompute_person_collision_flags: {
        Args: never
        Returns: {
          flagged_ambiguous: number
          flagged_duplicate: number
          flagged_review: number
          total_scanned: number
        }[]
      }
      recompute_person_gated_counts: {
        Args: never
        Returns: {
          single_ep_count: number
          updated_count: number
          zero_ep_count: number
        }[]
      }
      recompute_person_persona_flags: {
        Args: never
        Returns: {
          topic_figure_count: number
          topic_only_count: number
          updated_count: number
        }[]
      }
      recompute_person_role_counts: { Args: never; Returns: number }
      recompute_topic_cluster_counts: { Args: never; Returns: undefined }
      record_episode_interaction: {
        Args: { p_episode_id: string; p_kind: string; p_source?: string }
        Returns: undefined
      }
      refresh_episodes_search_text_batch: {
        Args: { _limit?: number }
        Returns: Json
      }
      refresh_homepage_feed: { Args: never; Returns: undefined }
      refresh_people_hub_score: { Args: never; Returns: Json }
      refresh_person_activation_status: { Args: never; Returns: Json }
      refresh_reddit_name_index: { Args: never; Returns: undefined }
      refresh_user_taste_vec: { Args: { p_user: string }; Returns: undefined }
      requeue_legacy_clean_text_v4_backfill: {
        Args: { _limit?: number; _tiers?: string[] }
        Returns: Json
      }
      resolve_canonical_entity_alias: {
        Args: { p_alias: string; p_entity_kind: string }
        Returns: {
          canonical_name: string
          canonical_slug: string
          entity_kind: string
          normalized_alias: string
          weight: number
        }[]
      }
      resolve_query_entities: {
        Args: { p_max?: number; p_q: string; p_threshold?: number }
        Returns: {
          display_name: string
          kind: string
          similarity: number
          slug: string
        }[]
      }
      search_backfill_batch: {
        Args: { _batch?: number; _table: string }
        Returns: number
      }
      search_episode_chunks: {
        Args: {
          candidate_pool?: number
          match_count?: number
          query_embedding: string
        }
        Returns: {
          best_source: string
          chunk_idx: number
          chunking_method: string
          content_snippet: string
          episode_id: string
          segment_end_idx: number
          segment_start_idx: number
          similarity: number
          source_transcript_model: string
          timestamp_end_seconds: number
          timestamp_start_seconds: number
        }[]
      }
      search_episodes_hybrid: {
        Args: {
          alpha_lex?: number
          entity_terms?: string[]
          lang?: string
          limit_n?: number
          p_decay_lambda?: number
          phrase_terms?: string[]
          q: string
          q_embedding?: string
          required_terms?: string[]
        }
        Returns: {
          episode_id: string
          lex_rank: number
          score: number
          sem_rank: number
        }[]
      }
      search_swipe_anchors: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          id: string
          image_url: string
          kind: string
          name: string
          rank: number
          slug: string
          subtitle: string
        }[]
      }
      select_classifier_candidates: {
        Args: { p_limit?: number; p_taxonomy_version?: string }
        Returns: {
          episode_id: string
          podcast_id: string
        }[]
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
      select_embed_chunks_candidates: {
        Args: { _limit: number; _model: string }
        Returns: {
          ai_summary: string
          clean_source_hash: string
          cleaned_text: string
          cleaner_method: string
          companies: string[]
          description: string
          display_title: string
          id: string
          ingredients: string[]
          people: string[]
          podcast_display_title: string
          podcast_id: string
          podcast_language: string
          podcast_tier: string
          podcast_title: string
          tickers: string[]
          title: string
          topics: string[]
          transcript_hash: string
          transcript_model: string
          transcript_segments: Json
        }[]
      }
      select_embed_episode_candidates: {
        Args: { _limit: number; _model: string }
        Returns: {
          ai_summary: string
          companies: string[]
          description: string
          display_title: string
          id: string
          ingredients: string[]
          people: string[]
          podcast_category: string
          podcast_display_title: string
          podcast_id: string
          podcast_title: string
          seo_description: string
          tickers: string[]
          title: string
          topics: string[]
        }[]
      }
      set_categorize_runner_schedule: {
        Args: { _schedule: string }
        Returns: string
      }
      set_deep_hydration_schedule: {
        Args: { _schedule: string }
        Returns: undefined
      }
      set_embed_episode_chunks_schedule: {
        Args: { _schedule: string }
        Returns: Json
      }
      set_embed_episode_schedule: {
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
      set_pi_dump_process_schedule: {
        Args: { pending_count: number }
        Returns: string
      }
      set_podcast_dedup_schedule: {
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      similar_episodes: {
        Args: { p_episode_id: string; p_limit?: number }
        Returns: {
          ai_summary: string
          audio_url: string
          description: string
          display_title: string
          episode_id: string
          podcast_category: string
          podcast_display_title: string
          podcast_id: string
          podcast_image_url: string
          podcast_slug: string
          podcast_title: string
          podiverzum_rank: number
          published_at: string
          rank_label: string
          related_reason: string
          similarity: number
          slug: string
          summary: string
          title: string
          topics: string[]
        }[]
      }
      similar_podcasts: {
        Args: { p_limit?: number; p_podcast_id: string }
        Returns: {
          apple_url: string
          category: string
          description: string
          display_title: string
          featured: boolean
          id: string
          image_url: string
          podiverzum_rank: number
          rank_label: string
          rss_status: string
          similarity: number
          slug: string
          spotify_url: string
          summary: string
          title: string
          website_url: string
          youtube_url: string
        }[]
      }
      slug_with_suffix: { Args: { base: string; n: number }; Returns: string }
      smart_player_discover: {
        Args: { p_episode_id: string; p_limit?: number }
        Returns: {
          audio_url: string
          best_char_start: number
          best_chunk_idx: number
          display_title: string
          episode_id: string
          image_url: string
          match_kind: string
          podcast_display_title: string
          podcast_id: string
          podcast_image_url: string
          podcast_slug: string
          podcast_title: string
          published_at: string
          seek_seconds: number
          shared_orgs: string[]
          shared_persons: string[]
          shared_topics: string[]
          similarity: number
          slug: string
          snippet: string
          sort_score: number
          title: string
          why_label: string
        }[]
      }
      suggest_token_corrections: {
        Args: { p_tokens: string[] }
        Returns: {
          df: number
          similarity: number
          suggestion: string
          token: string
        }[]
      }
      token_idf: {
        Args: { p_tokens: string[] }
        Returns: {
          df: number
          token: string
        }[]
      }
      top_episodes_all_time: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_one_per_podcast?: boolean
          p_podcast_slug?: string
        }
        Returns: {
          chart_appearances: number
          episode_id: string
          episode_image: string
          episode_slug: string
          episode_title: string
          podcast_id: string
          podcast_image: string
          podcast_slug: string
          podcast_title: string
          popularity_score: number
          published_at: string
          rank_label: string
          view_count: number
          youtube_video_id: string
        }[]
      }
      unaccent: { Args: { "": string }; Returns: string }
      update_page_event_dwell: {
        Args: { _dwell_ms: number; _id: string }
        Returns: undefined
      }
      upsert_scoped_person_alias: {
        Args: {
          p_alias_person_id: string
          p_canonical_person_id: string
          p_podcast_id: string
          p_reason?: string
        }
        Returns: Json
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
