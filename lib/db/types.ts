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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      anthropic_spend_daily: {
        Row: {
          day: string
          total_micro_usd: number
          updated_at: string
        }
        Insert: {
          day: string
          total_micro_usd?: number
          updated_at?: string
        }
        Update: {
          day?: string
          total_micro_usd?: number
          updated_at?: string
        }
        Relationships: []
      }
      channels: {
        Row: {
          competitor_set_json: Json
          country: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          handle: string | null
          id: string
          is_new_channel: boolean
          last_competitor_redetect_at: string | null
          last_refreshed_at: string
          low_cadence: boolean
          median_views: number | null
          niche: string | null
          niche_source: string
          subscriber_count: number | null
          title: string
          top_videos_json: Json
          total_views: number | null
          updated_at: string
          user_id: string
          youtube_channel_id: string
        }
        Insert: {
          competitor_set_json?: Json
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          handle?: string | null
          id?: string
          is_new_channel?: boolean
          last_competitor_redetect_at?: string | null
          last_refreshed_at?: string
          low_cadence?: boolean
          median_views?: number | null
          niche?: string | null
          niche_source?: string
          subscriber_count?: number | null
          title: string
          top_videos_json?: Json
          total_views?: number | null
          updated_at?: string
          user_id: string
          youtube_channel_id: string
        }
        Update: {
          competitor_set_json?: Json
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          handle?: string | null
          id?: string
          is_new_channel?: boolean
          last_competitor_redetect_at?: string | null
          last_refreshed_at?: string
          low_cadence?: boolean
          median_views?: number | null
          niche?: string | null
          niche_source?: string
          subscriber_count?: number | null
          title?: string
          top_videos_json?: Json
          total_views?: number | null
          updated_at?: string
          user_id?: string
          youtube_channel_id?: string
        }
        Relationships: []
      }
      login_attempts: {
        Row: {
          attempted_at: string
          email: string
          id: string
          ip_address: unknown
          outcome: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          attempted_at?: string
          email: string
          id?: string
          ip_address?: unknown
          outcome: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          attempted_at?: string
          email?: string
          id?: string
          ip_address?: unknown
          outcome?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      onboard_drafts: {
        Row: {
          created_at: string
          draft_id: string
          expires_at: string
          payload: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          draft_id: string
          expires_at?: string
          payload: Json
          user_id: string
        }
        Update: {
          created_at?: string
          draft_id?: string
          expires_at?: string
          payload?: Json
          user_id?: string
        }
        Relationships: []
      }
      pipeline_runs: {
        Row: {
          ab_plan_data: Json | null
          channel_id: string
          competitor_data: Json | null
          completed_at: string | null
          created_at: string
          current_stage: number | null
          deleted_at: string | null
          engagement_drafts_data: Json | null
          failure_reason: string | null
          gate_overridden_at: string | null
          gate_override_reason: string | null
          hook_data: Json | null
          id: string
          idea_text: string
          is_sponsored: boolean
          lint_data: Json | null
          score_data: Json | null
          script_data: Json | null
          script_locked_hook_index: number | null
          script_locked_title_index: number | null
          script_target_minutes: number | null
          seo_data: Json | null
          stale_ab_plan: boolean
          stale_competitor: boolean
          stale_engagement_drafts: boolean
          stale_hook: boolean
          stale_lint: boolean
          stale_score: boolean
          stale_script: boolean
          stale_seo: boolean
          stale_thumbnails: boolean
          stale_titles: boolean
          status: Database["public"]["Enums"]["pipeline_run_status"]
          thumbnails_data: Json | null
          titles_data: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ab_plan_data?: Json | null
          channel_id: string
          competitor_data?: Json | null
          completed_at?: string | null
          created_at?: string
          current_stage?: number | null
          deleted_at?: string | null
          engagement_drafts_data?: Json | null
          failure_reason?: string | null
          gate_overridden_at?: string | null
          gate_override_reason?: string | null
          hook_data?: Json | null
          id?: string
          idea_text: string
          is_sponsored?: boolean
          lint_data?: Json | null
          score_data?: Json | null
          script_data?: Json | null
          script_locked_hook_index?: number | null
          script_locked_title_index?: number | null
          script_target_minutes?: number | null
          seo_data?: Json | null
          stale_ab_plan?: boolean
          stale_competitor?: boolean
          stale_engagement_drafts?: boolean
          stale_hook?: boolean
          stale_lint?: boolean
          stale_score?: boolean
          stale_script?: boolean
          stale_seo?: boolean
          stale_thumbnails?: boolean
          stale_titles?: boolean
          status?: Database["public"]["Enums"]["pipeline_run_status"]
          thumbnails_data?: Json | null
          titles_data?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ab_plan_data?: Json | null
          channel_id?: string
          competitor_data?: Json | null
          completed_at?: string | null
          created_at?: string
          current_stage?: number | null
          deleted_at?: string | null
          engagement_drafts_data?: Json | null
          failure_reason?: string | null
          gate_overridden_at?: string | null
          gate_override_reason?: string | null
          hook_data?: Json | null
          id?: string
          idea_text?: string
          is_sponsored?: boolean
          lint_data?: Json | null
          score_data?: Json | null
          script_data?: Json | null
          script_locked_hook_index?: number | null
          script_locked_title_index?: number | null
          script_target_minutes?: number | null
          seo_data?: Json | null
          stale_ab_plan?: boolean
          stale_competitor?: boolean
          stale_engagement_drafts?: boolean
          stale_hook?: boolean
          stale_lint?: boolean
          stale_score?: boolean
          stale_script?: boolean
          stale_seo?: boolean
          stale_thumbnails?: boolean
          stale_titles?: boolean
          status?: Database["public"]["Enums"]["pipeline_run_status"]
          thumbnails_data?: Json | null
          titles_data?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_runs_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_channel_id: string | null
          channel_count_cache: number
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          active_channel_id?: string | null
          channel_count_cache?: number
          created_at?: string
          id: string
          updated_at?: string
        }
        Update: {
          active_channel_id?: string | null
          channel_count_cache?: number
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_channel_id_fkey"
            columns: ["active_channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      reframe_applications: {
        Row: {
          applied_at: string
          expected_score_lift: number | null
          id: string
          original_idea_text: string
          reframe_index: number
          revised_idea_text: string
          run_id: string
          user_id: string
        }
        Insert: {
          applied_at?: string
          expected_score_lift?: number | null
          id?: string
          original_idea_text: string
          reframe_index: number
          revised_idea_text: string
          run_id: string
          user_id: string
        }
        Update: {
          applied_at?: string
          expected_score_lift?: number | null
          id?: string
          original_idea_text?: string
          reframe_index?: number
          revised_idea_text?: string
          run_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reframe_applications_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      script_gen_throttle: {
        Row: {
          channel_id: string
          day: string
          full_count: number
          section_count: number
          updated_at: string
        }
        Insert: {
          channel_id: string
          day: string
          full_count?: number
          section_count?: number
          updated_at?: string
        }
        Update: {
          channel_id?: string
          day?: string
          full_count?: number
          section_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "script_gen_throttle_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      youtube_api_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          payload: Json
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at: string
          payload: Json
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          payload?: Json
        }
        Relationships: []
      }
      youtube_quota_usage: {
        Row: {
          consumer: string
          date: string
          id: string
          units_used: number
        }
        Insert: {
          consumer?: string
          date: string
          id?: string
          units_used?: number
        }
        Update: {
          consumer?: string
          date?: string
          id?: string
          units_used?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      pipeline_run_status:
        | "queued"
        | "running"
        | "gated_failed"
        | "complete"
        | "error"
        | "scored_overridden"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      pipeline_run_status: [
        "queued",
        "running",
        "gated_failed",
        "complete",
        "error",
        "scored_overridden",
      ],
    },
  },
} as const
