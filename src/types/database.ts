
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"details": NonNullable<Json>,"event_id": string | null,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"event_id"?: string | null,"id"?: string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"event_id"?: string | null,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "staff_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audit_logs_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"checkins": {
                  Row: {
                    "cancel_reason": string | null,"cancelled_at": string | null,"cancelled_by": string | null,"checked_in_at": string,"event_id": string,"id": string,"member_id": string,"staff_id": string,"station_id": string,"status": Database["public"]['Enums']["checkin_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"checked_in_at"?: string,"event_id": string,"id"?: string,"member_id": string,"staff_id": string,"station_id": string,"status"?: Database["public"]['Enums']["checkin_status"]
                  }
                  Update: {
                    "cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"checked_in_at"?: string,"event_id"?: string,"id"?: string,"member_id"?: string,"staff_id"?: string,"station_id"?: string,"status"?: Database["public"]['Enums']["checkin_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "checkins_cancelled_by_fkey"
      columns: ["cancelled_by"]
isOneToOne: false
      referencedRelation: "staff_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checkins_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checkins_event_id_member_id_fkey"
      columns: ["event_id","member_id"]
isOneToOne: true
      referencedRelation: "event_members"
      referencedColumns: ["event_id","member_id"]
    },{
      foreignKeyName: "checkins_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checkins_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checkins_station_id_fkey"
      columns: ["station_id"]
isOneToOne: false
      referencedRelation: "stations"
      referencedColumns: ["id"]
    }
                  ]
                },"event_members": {
                  Row: {
                    "created_at": string,"event_id": string,"member_id": string,"payout_seq": number | null,"station_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"member_id": string,"payout_seq"?: number | null,"station_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"member_id"?: string,"payout_seq"?: number | null,"station_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_members_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_members_member_id_fkey"
      columns: ["member_id"]
isOneToOne: false
      referencedRelation: "members"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "created_at": string,"event_date": string,"id": string,"status": Database["public"]['Enums']["event_status"],"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_date": string,"id"?: string,"status"?: Database["public"]['Enums']["event_status"],"title": string
                  }
                  Update: {
                    "created_at"?: string,"event_date"?: string,"id"?: string,"status"?: Database["public"]['Enums']["event_status"],"title"?: string
                  }
                  Relationships: [
                    
                  ]
                },"members": {
                  Row: {
                    "created_at": string,"department": string | null,"full_name": string,"id": string,"is_active": boolean,"member_no": string,"member_type": Database["public"]['Enums']["member_type"],"member_unit": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"department"?: string | null,"full_name": string,"id"?: string,"is_active"?: boolean,"member_no": string,"member_type": Database["public"]['Enums']["member_type"],"member_unit"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"department"?: string | null,"full_name"?: string,"id"?: string,"is_active"?: boolean,"member_no"?: string,"member_type"?: Database["public"]['Enums']["member_type"],"member_unit"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"staff_profiles": {
                  Row: {
                    "created_at": string,"full_name": string,"id": string,"is_active": boolean,"role": Database["public"]['Enums']["staff_role"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"full_name": string,"id": string,"is_active"?: boolean,"role"?: Database["public"]['Enums']["staff_role"]
                  }
                  Update: {
                    "created_at"?: string,"full_name"?: string,"id"?: string,"is_active"?: boolean,"role"?: Database["public"]['Enums']["staff_role"]
                  }
                  Relationships: [
                    
                  ]
                },"staff_station_assignments": {
                  Row: {
                    "created_at": string,"event_id": string,"id": string,"is_active": boolean,"staff_id": string,"station_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"id"?: string,"is_active"?: boolean,"staff_id": string,"station_id": string
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"id"?: string,"is_active"?: boolean,"staff_id"?: string,"station_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_station_assignments_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_station_assignments_staff_id_fkey"
      columns: ["staff_id"]
isOneToOne: false
      referencedRelation: "staff_profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "staff_station_assignments_station_id_fkey"
      columns: ["station_id"]
isOneToOne: false
      referencedRelation: "stations"
      referencedColumns: ["id"]
    }
                  ]
                },"stations": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"station_code": string,"station_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"station_code": string,"station_name": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"station_code"?: string,"station_name"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "assign_station":
{ Args: { "p_event_id": string,"p_staff_id": string,"p_station_id": string }; Returns: Json
                           },
"cancel_checkin":
{ Args: { "p_checkin_id": string,"p_reason": string }; Returns: Json
                           },
"export_report":
{ Args: { "p_event_id": string,"p_filter"?: string,"p_format": string,"p_from"?: string,"p_member_type"?: Database["public"]['Enums']["member_type"],"p_station_id"?: string,"p_to"?: string }; Returns: {
              "checked_in_at": string,"checkin_status": Database["public"]['Enums']["checkin_status"],"department": string,"full_name": string,"is_registered": boolean,"member_no": string,"member_type": Database["public"]['Enums']["member_type"],"staff_name": string,"station_code": string,"station_name": string,"member_unit": string,"assigned_station_code": string,"assigned_station_name": string,"payout_seq": number
            }[]
                           },
"generate_eligibility":
{ Args: { "p_event_id": string,"p_include_associate"?: boolean }; Returns: Json
                           },
"get_checkin_status":
{ Args: { "p_event_id": string,"p_member_id": string }; Returns: Json
                           },
"get_dashboard_stats":
{ Args: { "p_event_id": string }; Returns: Json
                           },
"get_my_context":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_report":
{ Args: { "p_event_id": string,"p_filter"?: string,"p_from"?: string,"p_limit"?: number,"p_member_type"?: Database["public"]['Enums']["member_type"],"p_offset"?: number,"p_station_id"?: string,"p_to"?: string }; Returns: Json
                           },
"import_event_roster":
{ Args: { "p_dry_run"?: boolean,"p_event_id": string,"p_rows": Json }; Returns: Json
                           },
"import_members":
{ Args: { "p_dry_run"?: boolean,"p_rows": Json }; Returns: Json
                           },
"list_checkins":
{ Args: { "p_event_id": string,"p_from"?: string,"p_limit"?: number,"p_member_type"?: Database["public"]['Enums']["member_type"],"p_offset"?: number,"p_station_id"?: string,"p_status"?: Database["public"]['Enums']["checkin_status"],"p_to"?: string }; Returns: Json
                           },
"list_staff":
{ Args: Record<PropertyKey, never>; Returns: {
              "created_at": string,"email": string,"full_name": string,"id": string,"is_active": boolean,"role": Database["public"]['Enums']["staff_role"]
            }[]
                           },
"reactivate_checkin":
{ Args: { "p_checkin_id": string,"p_reason": string }; Returns: Json
                           },
"register_member":
{ Args: { "p_event_id": string,"p_member_id": string }; Returns: Json
                           },
"save_event":
{ Args: { "p_event_date": string,"p_event_id": string,"p_title": string }; Returns: Json
                           },
"save_station":
{ Args: { "p_is_active": boolean,"p_station_code": string,"p_station_id": string,"p_station_name": string }; Returns: Json
                           },
"search_members":
{ Args: { "p_query": string }; Returns: {
              "checked_in_at": string,"checkin_status": Database["public"]['Enums']["checkin_status"],"department": string,"full_name": string,"id": string,"is_active": boolean,"is_eligible": boolean,"member_no": string,"member_type": Database["public"]['Enums']["member_type"],"station_code": string,"station_name": string,"member_unit": string,"assigned_station_code": string,"assigned_station_name": string,"payout_seq": number
            }[]
                           },
"set_event_status":
{ Args: { "p_event_id": string,"p_status": Database["public"]['Enums']["event_status"] }; Returns: Json
                           },
"set_member_active":
{ Args: { "p_is_active": boolean,"p_member_id": string }; Returns: Json
                           },
"set_member_eligibility":
{ Args: { "p_eligible": boolean,"p_event_id": string,"p_member_id": string }; Returns: Json
                           },
"update_staff":
{ Args: { "p_full_name": string,"p_is_active": boolean,"p_role": Database["public"]['Enums']["staff_role"],"p_staff_id": string }; Returns: Json
                           }
          }
          Enums: {
            "checkin_status": "active"|"cancelled","event_status": "draft"|"open"|"closed","member_type": "ordinary"|"associate","staff_role": "admin"|"supervisor"|"staff"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "checkin_status": ["active", "cancelled"],"event_status": ["draft", "open", "closed"],"member_type": ["ordinary", "associate"],"staff_role": ["admin", "supervisor", "staff"]
          }
        }
} as const
