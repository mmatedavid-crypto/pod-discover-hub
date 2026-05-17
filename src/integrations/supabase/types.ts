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
          active: boolean
          created_at: string
          description: string | null
          id: string
          name: string
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
          name: string
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
          name?: string
          seo_description?: string | null
          seo_title?: string | null
          seo_updated_at?: string | null
          slug?: string
          sort_order?: number
          taxonomy_keys?: string[]
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
        ]
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
      episode_chunks: {
        Row: {
          char_end: number
          char_start: number
          chunk_count: number
          chunk_idx: number
          content: string
          content_hash: string
          embedding: string
          episode_id: string
          model: string
          podcast_id: string
          updated_at: string
        }
        Insert: {
          char_end?: number
          char_start?: number
          chunk_count: number
          chunk_idx: number
          content: string
          content_hash: string
          embedding: string
          episode_id: string
          model: string
          podcast_id: string
          updated_at?: string
        }
        Update: {
          char_end?: number
          char_start?: number
          chunk_count?: number
          chunk_idx?: number
          content?: string
          content_hash?: string
          embedding?: string
          episode_id?: string
          model?: string
          podcast_id?: string
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
            foreignKeyName: "episode_topic_map_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
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
          id: string
          input_tokens: number | null
          language: string | null
          model: string
          output_tokens: number | null
          podcast_id: string
          segments: Json | null
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
          id?: string
          input_tokens?: number | null
          language?: string | null
          model: string
          output_tokens?: number | null
          podcast_id: string
          segments?: Json | null
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
          id?: string
          input_tokens?: number | null
          language?: string | null
          model?: string
          output_tokens?: number | null
          podcast_id?: string
          segments?: Json | null
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
          ai_enriched_at: string | null
          ai_entities_version: number
          ai_summary: string | null
          ai_summary_source: string | null
          apple_url: string | null
          audio_url: string | null
          companies: string[] | null
          created_at: string
          description: string | null
          detected_language: string | null
          display_title: string | null
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
          language_checked_at: string | null
          language_evidence: Json
          mentioned: string[]
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
          topics: string[] | null
          updated_at: string
          youtube_match_score: number | null
          youtube_paired_at: string | null
          youtube_pairing_status: string
          youtube_url: string | null
          youtube_video_id: string | null
        }
        Insert: {
          ai_enriched_at?: string | null
          ai_entities_version?: number
          ai_summary?: string | null
          ai_summary_source?: string | null
          apple_url?: string | null
          audio_url?: string | null
          companies?: string[] | null
          created_at?: string
          description?: string | null
          detected_language?: string | null
          display_title?: string | null
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
          language_checked_at?: string | null
          language_evidence?: Json
          mentioned?: string[]
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
          topics?: string[] | null
          updated_at?: string
          youtube_match_score?: number | null
          youtube_paired_at?: string | null
          youtube_pairing_status?: string
          youtube_url?: string | null
          youtube_video_id?: string | null
        }
        Update: {
          ai_enriched_at?: string | null
          ai_entities_version?: number
          ai_summary?: string | null
          ai_summary_source?: string | null
          apple_url?: string | null
          audio_url?: string | null
          companies?: string[] | null
          created_at?: string
          description?: string | null
          detected_language?: string | null
          display_title?: string | null
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
          language_checked_at?: string | null
          language_evidence?: Json
          mentioned?: string[]
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
      mood_collections: {
        Row: {
          accent_hsl: string | null
          active: boolean
          created_at: string
          description: string | null
          episode_ids: string[]
          id: string
          mood: string
          podcast_ids: string[]
          seed_query: string | null
          slug: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          accent_hsl?: string | null
          active?: boolean
          created_at?: string
          description?: string | null
          episode_ids?: string[]
          id?: string
          mood: string
          podcast_ids?: string[]
          seed_query?: string | null
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          accent_hsl?: string | null
          active?: boolean
          created_at?: string
          description?: string | null
          episode_ids?: string[]
          id?: string
          mood?: string
          podcast_ids?: string[]
          seed_query?: string | null
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
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
          browsable_reason: string | null
          canonical_identity_key: string | null
          confidence: number
          created_at: string
          disambiguation_context: string | null
          disambiguation_label: string | null
          distinct_podcast_count: number
          editorial_notes: string | null
          editorial_priority: boolean
          editorial_priority_level: number
          episode_count: number
          guest_count: number
          host_count: number
          id: string
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
          is_indexable: boolean
          is_public: boolean
          latest_accepted_relevant_episode_at: string | null
          latest_episode_at: string | null
          manual_approval_status: string
          manual_approved: boolean
          manually_seeded: boolean
          mentioned_count: number
          name: string
          normalized_name: string
          one_show_host: boolean
          overview_generated_at: string | null
          overview_sources: Json
          overview_text: string | null
          people_hub_score: number
          podcast_count: number
          recent_relevant_episode_count_30d: number
          short_bio: string | null
          slug: string
          strong_mention_count: number
          subject_count: number
          updated_at: string
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
          browsable_reason?: string | null
          canonical_identity_key?: string | null
          confidence?: number
          created_at?: string
          disambiguation_context?: string | null
          disambiguation_label?: string | null
          distinct_podcast_count?: number
          editorial_notes?: string | null
          editorial_priority?: boolean
          editorial_priority_level?: number
          episode_count?: number
          guest_count?: number
          host_count?: number
          id?: string
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
          is_indexable?: boolean
          is_public?: boolean
          latest_accepted_relevant_episode_at?: string | null
          latest_episode_at?: string | null
          manual_approval_status?: string
          manual_approved?: boolean
          manually_seeded?: boolean
          mentioned_count?: number
          name: string
          normalized_name: string
          one_show_host?: boolean
          overview_generated_at?: string | null
          overview_sources?: Json
          overview_text?: string | null
          people_hub_score?: number
          podcast_count?: number
          recent_relevant_episode_count_30d?: number
          short_bio?: string | null
          slug: string
          strong_mention_count?: number
          subject_count?: number
          updated_at?: string
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
          browsable_reason?: string | null
          canonical_identity_key?: string | null
          confidence?: number
          created_at?: string
          disambiguation_context?: string | null
          disambiguation_label?: string | null
          distinct_podcast_count?: number
          editorial_notes?: string | null
          editorial_priority?: boolean
          editorial_priority_level?: number
          episode_count?: number
          guest_count?: number
          host_count?: number
          id?: string
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
          is_indexable?: boolean
          is_public?: boolean
          latest_accepted_relevant_episode_at?: string | null
          latest_episode_at?: string | null
          manual_approval_status?: string
          manual_approved?: boolean
          manually_seeded?: boolean
          mentioned_count?: number
          name?: string
          normalized_name?: string
          one_show_host?: boolean
          overview_generated_at?: string | null
          overview_sources?: Json
          overview_text?: string | null
          people_hub_score?: number
          podcast_count?: number
          recent_relevant_episode_count_30d?: number
          short_bio?: string | null
          slug?: string
          strong_mention_count?: number
          subject_count?: number
          updated_at?: string
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
          source: string | null
        }
        Insert: {
          alias: string
          confidence?: number
          created_at?: string
          id?: string
          normalized_alias: string
          person_id: string
          source?: string | null
        }
        Update: {
          alias?: string
          confidence?: number
          created_at?: string
          id?: string
          normalized_alias?: string
          person_id?: string
          source?: string | null
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
        ]
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
          source: string | null
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
          source?: string | null
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
          source?: string | null
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
            foreignKeyName: "podcast_topic_map_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
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
          confidence_band: string | null
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
          confidence_band?: string | null
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
          confidence_band?: string | null
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
        ]
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
          name: string
          parent_topic_id: string | null
          podcast_count: number
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
          name: string
          parent_topic_id?: string | null
          podcast_count?: number
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
          name?: string
          parent_topic_id?: string | null
          podcast_count?: number
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
        ]
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
    }
    Functions: {
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
      is_publicly_visible_hu_podcast: {
        Args: { p_id: string }
        Returns: boolean
      }
      match_podcast_by_name: {
        Args: { p_max?: number; p_q: string; p_threshold?: number }
        Returns: {
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
      merge_duplicate_podcasts: {
        Args: { _canonical_id: string; _duplicate_id: string; _reason?: string }
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
      normalize_rss_url: { Args: { _url: string }; Returns: string }
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
      refresh_episodes_search_text_batch: {
        Args: { _limit?: number }
        Returns: Json
      }
      refresh_homepage_feed: { Args: never; Returns: undefined }
      refresh_people_hub_score: { Args: never; Returns: Json }
      refresh_person_activation_status: { Args: never; Returns: Json }
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
      unaccent: { Args: { "": string }; Returns: string }
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
