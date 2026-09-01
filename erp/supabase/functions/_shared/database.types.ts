export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type StaffRole =
  | "owner"
  | "admin"
  | "manager"
  | "reception"
  | "therapist"
  | "accountant"
  | "auditor"
  | "viewer"

export type StaffStatus = "invited" | "active" | "suspended"

export type Database = {
  public: {
    Tables: {
      staff_profiles: {
        Row: {
          id: string
          email: string
          full_name: string
          role: StaffRole
          status: StaffStatus
          invited_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name: string
          role?: StaffRole
          status?: StaffStatus
          invited_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          role?: StaffRole
          status?: StaffStatus
          invited_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      staff_invites: {
        Row: {
          id: number
          email: string
          full_name: string
          intended_role: StaffRole
          status: "pending" | "sending" | "sent" | "linked" | "accepted" | "failed" | "expired"
          invited_by: string
          last_action_by: string
          auth_user_id: string | null
          processing_token: string | null
          processing_started_at: string | null
          expires_at: string
          error_code: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          email: string
          full_name: string
          intended_role: StaffRole
          status?: "pending" | "sending" | "sent" | "linked" | "accepted" | "failed" | "expired"
          invited_by: string
          last_action_by: string
          auth_user_id?: string | null
          processing_token?: string | null
          processing_started_at?: string | null
          expires_at?: string
          error_code?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          email?: string
          full_name?: string
          intended_role?: StaffRole
          status?: "pending" | "sending" | "sent" | "linked" | "accepted" | "failed" | "expired"
          invited_by?: string
          last_action_by?: string
          auth_user_id?: string | null
          processing_token?: string | null
          processing_started_at?: string | null
          expires_at?: string
          error_code?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      reserve_staff_invite: {
        Args: {
          p_idempotency_key: string
          p_attempt_token: string
          p_email: string
          p_full_name: string
          p_intended_role: StaffRole
          p_invited_by: string
        }
        Returns: Array<{
          invite_id: number
          invite_status: string
          auth_user_id: string | null
          reservation_token: string | null
          should_send: boolean
        }>
      }
      finalize_staff_invite: {
        Args: {
          p_invite_id: number
          p_auth_user_id: string
          p_attempt_token: string
          p_email_confirmed?: boolean
        }
        Returns: string
      }
      fail_staff_invite: {
        Args: {
          p_invite_id: number
          p_attempt_token: string
          p_error_code: string
        }
        Returns: boolean
      }
      update_staff_access: {
        Args: {
          p_target_user_id: string
          p_role: StaffRole
          p_status: StaffStatus
          p_reason: string
        }
        Returns: Array<{
          id: string
          email: string
          full_name: string
          role: StaffRole
          status: StaffStatus
        }>
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
