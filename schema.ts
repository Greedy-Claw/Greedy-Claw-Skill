export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: { [_ in never]: never };
    Views: { [_ in never]: never };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
  public: {
    Tables: {
      agent_full_profile: {
        Row: {user_id: string;
  credit_score: number;
  total_tasks_completed: number;
  avg_rating: number;
  dispute_rate: number;
  on_time_rate: number;}
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
        Relationships: [];
      };
      agent_profiles: {
        Row: {user_id: string;
  credit_score: number;}
        Insert: {user_id: string;
  /** Default value: 1000 */
  credit_score?: number;}
        Update: {user_id?: string;
  credit_score?: number;}
        Relationships: [];
      };
      /** Represents the table public.api_keys */
      api_keys: {
        Row: {id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  created_at: string;
  last_used_at: string | null;}
        Insert: {/** Default value: gen_random_uuid() */
  id?: string;
  user_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  /** Default value: timezone('utc'::text, now()) */
  created_at?: string;
  last_used_at?: string | null;}
        Update: {id?: string;
  user_id?: string;
  name?: string;
  key_prefix?: string;
  key_hash?: string;
  created_at?: string;
  last_used_at?: string | null;}
        Relationships: [];
      };
      /** Represents the table public.bids */
      bids: {
        Row: {id: string;
  task_id: string;
  price: number;
  eta_seconds: number;
  created_at: string;
  /** Proposal内容，MD格式存储，支持大量文本 */
  proposal: string | null;
  /** [DEPRECATED] 此字段已废弃，将于后续迁移中删除 */
  outcome: string | null;
  executor_id: string | null;
  /** Bid状态: PENDING(待处理), SHORTLISTED(已入围), ACCEPTED(已签约), CANCELLED(已取消), OUTDATED(已失效) */
  status: string;
  /** Proposal摘要，纯文本形式，支持换行符，最大长度500字符 */
  proposal_summary: string | null;
  /** 交付摘要，纯文本形式，最大长度500字符 */
  delivery_summary: string | null;
  /** 交付详情，MD格式存储，可选 */
  delivery_md: string | null;
  /** 交付文件ID列表，关联 storage_files.id */
  delivery_files_list: string[] | null;}
        Insert: {/** Default value: gen_random_uuid() */
  id?: string;
  task_id: string;
  price: number;
  eta_seconds: number;
  /** Default value: timezone('utc'::text, now()) */
  created_at?: string;
  /** Proposal内容，MD格式存储，支持大量文本 */
  proposal?: string | null;
  /** [DEPRECATED] 此字段已废弃，将于后续迁移中删除 */
  outcome?: string | null;
  executor_id?: string | null;
  /**
   * Bid状态: PENDING(待处理), SHORTLISTED(已入围), ACCEPTED(已签约), CANCELLED(已取消), OUTDATED(已失效)
   * Default value: 'PENDING'::text
   */
  status?: string;
  /** Proposal摘要，纯文本形式，支持换行符，最大长度500字符 */
  proposal_summary?: string | null;
  /** 交付摘要，纯文本形式，最大长度500字符 */
  delivery_summary?: string | null;
  /** 交付详情，MD格式存储，可选 */
  delivery_md?: string | null;
  /** 交付文件ID列表，关联 storage_files.id */
  delivery_files_list?: string[] | null;}
        Update: {id?: string;
  task_id?: string;
  price?: number;
  eta_seconds?: number;
  created_at?: string;
  /** Proposal内容，MD格式存储，支持大量文本 */
  proposal?: string | null;
  /** [DEPRECATED] 此字段已废弃，将于后续迁移中删除 */
  outcome?: string | null;
  executor_id?: string | null;
  /** Bid状态: PENDING(待处理), SHORTLISTED(已入围), ACCEPTED(已签约), CANCELLED(已取消), OUTDATED(已失效) */
  status?: string;
  /** Proposal摘要，纯文本形式，支持换行符，最大长度500字符 */
  proposal_summary?: string | null;
  /** 交付摘要，纯文本形式，最大长度500字符 */
  delivery_summary?: string | null;
  /** 交付详情，MD格式存储，可选 */
  delivery_md?: string | null;
  /** 交付文件ID列表，关联 storage_files.id */
  delivery_files_list?: string[] | null;}
        Relationships: [];
      };
      /** Represents the table public.bids_messages */
      bids_messages: {
        Row: {id: string;
  bid_id: string;
  sender_id: string;
  content: string;
  created_at: string;}
        Insert: {/** Default value: gen_random_uuid() */
  id?: string;
  bid_id: string;
  sender_id: string;
  /** Default value: ''::text */
  content?: string;
  /** Default value: timezone('utc'::text, now()) */
  created_at?: string;}
        Update: {id?: string;
  bid_id?: string;
  sender_id?: string;
  content?: string;
  created_at?: string;}
        Relationships: [];
      };
      /** Represents the table public.deliveries */
      deliveries: {
        Row: {id: string;
  task_id: string;
  executor_id: string | null;
  email_status: string;
  message_id: string | null;
  header_fingerprint: string | null;
  body_hash: string | null;
  attachments_sha256: Record<string, unknown> | null;
  submitted_at: string;
  /** 附件在 Storage 中的路径信息，包含 filename/path/sha256 字段的 JSON 数组 */
  storage_paths: Record<string, unknown> | null;}
        Insert: {/** Default value: gen_random_uuid() */
  id?: string;
  task_id: string;
  executor_id?: string | null;
  email_status: string;
  message_id?: string | null;
  header_fingerprint?: string | null;
  body_hash?: string | null;
  attachments_sha256?: Record<string, unknown> | null;
  /** Default value: timezone('utc'::text, now()) */
  submitted_at?: string;
  /** 附件在 Storage 中的路径信息，包含 filename/path/sha256 字段的 JSON 数组 */
  storage_paths?: Record<string, unknown> | null;}
        Update: {id?: string;
  task_id?: string;
  executor_id?: string | null;
  email_status?: string;
  message_id?: string | null;
  header_fingerprint?: string | null;
  body_hash?: string | null;
  attachments_sha256?: Record<string, unknown> | null;
  submitted_at?: string;
  /** 附件在 Storage 中的路径信息，包含 filename/path/sha256 字段的 JSON 数组 */
  storage_paths?: Record<string, unknown> | null;}
        Relationships: [];
      };
      /** Represents the table public.disputes */
      disputes: {
        Row: {id: string;
  task_id: string;
  initiator_id: string;
  reason: string | null;
  status: string;
  evidence_email_hash: string | null;}
        Insert: {/** Default value: gen_random_uuid() */
  id?: string;
  task_id: string;
  initiator_id: string;
  reason?: string | null;
  /** Default value: 'PENDING'::text */
  status?: string;
  evidence_email_hash?: string | null;}
        Update: {id?: string;
  task_id?: string;
  initiator_id?: string;
  reason?: string | null;
  status?: string;
  evidence_email_hash?: string | null;}
        Relationships: [];
      };
      /** Represents the table public.heartbeat_buffer */
      heartbeat_buffer: {
        Row: {node_id: string;
  ping_at: string | null;}
        Insert: {node_id: string;
  /** Default value: now() */
  ping_at?: string | null;}
        Update: {node_id?: string;
  ping_at?: string | null;}
        Relationships: [];
      };
      storage_files: {
        Row: {/** 主键 */
  id: string;
  /** 关联的 bid ID（从路径解析，可能为 NULL 如果路径格式不符） */
  bid_id: string | null;
  /** Storage 路径，格式为 task_id/bid_id/role/filename */
  storage_path: string;
  /** 用户自定义元数据，如 original_name 字段存储原始文件名 */
  user_metadata: Record<string, unknown> | null;
  /** 创建时间 */
  created_at: string | null;
  /** 上传者 user_id */
  created_by: string | null;
  /** 原始文件名，从 storage.objects user_metadata->>file_name 读取 */
  file_name: string | null;
  /** 文件大小（字节），从 storage.objects user_metadata->>size 读取 */
  file_size: number | null;
  /** storage.objects.id，用于关联和级联删除 */
  storage_key: string | null;
  /** 记录更新时间 */
  updated_at: string | null;}
        Insert: {/**
   * 主键
   * Default value: gen_random_uuid()
   */
  id?: string;
  /** 关联的 bid ID（从路径解析，可能为 NULL 如果路径格式不符） */
  bid_id?: string | null;
  /** Storage 路径，格式为 task_id/bid_id/role/filename */
  storage_path: string;
  /**
   * 用户自定义元数据，如 original_name 字段存储原始文件名
   * Default value: empty object
   */
  user_metadata?: Record<string, unknown> | null;
  /**
   * 创建时间
   * Default value: now()
   */
  created_at?: string | null;
  /** 上传者 user_id */
  created_by?: string | null;
  /** 原始文件名，从 storage.objects user_metadata->>file_name 读取 */
  file_name?: string | null;
  /** 文件大小（字节），从 storage.objects user_metadata->>size 读取 */
  file_size?: number | null;
  /** storage.objects.id，用于关联和级联删除 */
  storage_key?: string | null;
  /**
   * 记录更新时间
   * Default value: now()
   */
  updated_at?: string | null;}
        Update: {/** 主键 */
  id?: string;
  /** 关联的 bid ID（从路径解析，可能为 NULL 如果路径格式不符） */
  bid_id?: string | null;
  /** Storage 路径，格式为 task_id/bid_id/role/filename */
  storage_path?: string;
  /** 用户自定义元数据，如 original_name 字段存储原始文件名 */
  user_metadata?: Record<string, unknown> | null;
  /** 创建时间 */
  created_at?: string | null;
  /** 上传者 user_id */
  created_by?: string | null;
  /** 原始文件名，从 storage.objects user_metadata->>file_name 读取 */
  file_name?: string | null;
  /** 文件大小（字节），从 storage.objects user_metadata->>size 读取 */
  file_size?: number | null;
  /** storage.objects.id，用于关联和级联删除 */
  storage_key?: string | null;
  /** 记录更新时间 */
  updated_at?: string | null;}
        Relationships: [];
      };
      task_executor_blacklist: {
        Row: {id: string;
  /** 关联任务ID */
  task_id: string;
  /** 被加入黑名单的执行者ID */
  executor_id: string;
  /** 加入黑名单的时间 */
  created_at: string;}
        Insert: {/** Default value: gen_random_uuid() */
  id?: string;
  /** 关联任务ID */
  task_id: string;
  /** 被加入黑名单的执行者ID */
  executor_id: string;
  /**
   * 加入黑名单的时间
   * Default value: timezone('utc'::text, now())
   */
  created_at?: string;}
        Update: {id?: string;
  /** 关联任务ID */
  task_id?: string;
  /** 被加入黑名单的执行者ID */
  executor_id?: string;
  /** 加入黑名单的时间 */
  created_at?: string;}
        Relationships: [];
      };
      /** Represents the table public.tasks */
      tasks: {
        Row: {id: string;
  instruction: string;
  status: string;
  result_data: Record<string, unknown> | null;
  created_at: string;
  review: number | null;
  owner_id: string | null;
  executor_id: string | null;
  currency_type: string | null;
  locked_amount: number | null;
  task_type: string;
  cron_expr: string | null;
  recurring_buffer: number | null;}
        Insert: {/** Default value: gen_random_uuid() */
  id?: string;
  instruction: string;
  /** Default value: 'OPEN'::text */
  status?: string;
  result_data?: Record<string, unknown> | null;
  /** Default value: timezone('utc'::text, now()) */
  created_at?: string;
  review?: number | null;
  owner_id?: string | null;
  executor_id?: string | null;
  /** Default value: 'SILVER'::text */
  currency_type?: string | null;
  /** Default value: 0 */
  locked_amount?: number | null;
  /** Default value: 'FIXED_RUN'::text */
  task_type?: string;
  cron_expr?: string | null;
  recurring_buffer?: number | null;}
        Update: {id?: string;
  instruction?: string;
  status?: string;
  result_data?: Record<string, unknown> | null;
  created_at?: string;
  review?: number | null;
  owner_id?: string | null;
  executor_id?: string | null;
  currency_type?: string | null;
  locked_amount?: number | null;
  task_type?: string;
  cron_expr?: string | null;
  recurring_buffer?: number | null;}
        Relationships: [];
      };
      /** Represents the table public.transactions */
      transactions: {
        Row: {id: string;
  task_id: string | null;
  from_user_id: string | null;
  to_user_id: string | null;
  amount: number;
  currency: string;
  type: string;
  description: string | null;
  created_at: string;}
        Insert: {/** Default value: gen_random_uuid() */
  id?: string;
  task_id?: string | null;
  from_user_id?: string | null;
  to_user_id?: string | null;
  amount: number;
  currency: string;
  type: string;
  description?: string | null;
  /** Default value: timezone('utc'::text, now()) */
  created_at?: string;}
        Update: {id?: string;
  task_id?: string | null;
  from_user_id?: string | null;
  to_user_id?: string | null;
  amount?: number;
  currency?: string;
  type?: string;
  description?: string | null;
  created_at?: string;}
        Relationships: [];
      };
      user_api_keys: {
        Row: {id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;}
        Insert: Record<string, unknown>
        Update: Record<string, unknown>
        Relationships: [];
      };
      /** Represents the table public.wallets */
      wallets: {
        Row: {id: string;
  user_id: string;
  gold_balance: number;
  silver_balance: number;
  created_at: string;
  updated_at: string;
  last_heartbeat_at: string | null;}
        Insert: {/** Default value: gen_random_uuid() */
  id?: string;
  user_id: string;
  /** Default value: 0 */
  gold_balance?: number;
  /** Default value: 500 */
  silver_balance?: number;
  /** Default value: timezone('utc'::text, now()) */
  created_at?: string;
  /** Default value: timezone('utc'::text, now()) */
  updated_at?: string;
  last_heartbeat_at?: string | null;}
        Update: {id?: string;
  user_id?: string;
  gold_balance?: number;
  silver_balance?: number;
  created_at?: string;
  updated_at?: string;
  last_heartbeat_at?: string | null;}
        Relationships: [];
      };
    };
    Views: {
      agent_stats: {
        Row: {user_id: string | null;
  total_tasks_completed: number;
  avg_rating: number;
  dispute_rate: number;
  on_time_rate: number;};
      };
    };
    Functions: {
      accept_bid: {
        Args: {p_task_id: string;
  p_bid_id: string;};
        Returns: unknown;
      };
      auto_confirm_task: {
        Args: {p_task_id: string;};
        Returns: unknown;
      };
      cancel_shortlist: {
        Args: {p_task_id: string;};
        Returns: unknown;
      };
      confirm_task: {
        Args: {p_task_id: string;
  p_review: number;};
        Returns: unknown;
      };
      executor_submit_result: {
        Args: {p_task_id: string;
  p_result_data: unknown;
  p_status: string;
  p_delivery_summary: string;
  p_delivery_md: string;
  p_delivery_files_list: string[];};
        Returns: unknown;
      };
      flush_heartbeats_and_reward: {
        Args: {};
        Returns: unknown;
      };
      generate_api_key: {
        Args: {p_user_id: string;
  p_name: string;
  p_key_prefix: string;
  p_key_hash: string;
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  created_at: unknown;};
        Returns: unknown;
      };
      get_agent_stats: {
        Args: {p_user_id: string;
  user_id: string;
  total_tasks_completed: string;
  avg_rating: string;
  dispute_rate: string;
  on_time_rate: string;};
        Returns: unknown;
      };
      get_bid_messages: {
        Args: {p_bid_id: string;};
        Returns: unknown;
      };
      get_my_full_profile: {
        Args: {user_id: string;
  credit_score: number;
  total_tasks_completed: string;
  avg_rating: string;
  dispute_rate: string;
  on_time_rate: string;};
        Returns: unknown;
      };
      get_online_lobsters_count: {
        Args: {};
        Returns: unknown;
      };
      get_wallet: {
        Args: {};
        Returns: unknown;
      };
      handle_new_user_wallet: {
        Args: {};
        Returns: unknown;
      };
      lock_delivery_fields_trigger: {
        Args: {};
        Returns: unknown;
      };
      on_storage_object_delete: {
        Args: {};
        Returns: unknown;
      };
      on_storage_object_insert: {
        Args: {};
        Returns: unknown;
      };
      owner_update_task: {
        Args: {p_task_id: string;
  p_executor_id: string;
  p_review: number;};
        Returns: unknown;
      };
      raise_dispute: {
        Args: {p_task_id: string;
  p_reason: string;
  p_evidence_email_hash: string;};
        Returns: unknown;
      };
      recharge: {
        Args: {p_amount: string;
  p_currency: string;};
        Returns: unknown;
      };
      resolve_dispute: {
        Args: {p_dispute_id: string;
  p_resolution: string;};
        Returns: unknown;
      };
      send_bid_message: {
        Args: {p_bid_id: string;
  p_content: string;};
        Returns: unknown;
      };
      set_storage_files_updated_at: {
        Args: {};
        Returns: unknown;
      };
      shortlist_bid: {
        Args: {p_task_id: string;
  p_bid_id: string;};
        Returns: unknown;
      };
      update_bid_price: {
        Args: {p_task_id: string;
  p_bid_id: string;
  p_new_price: string;};
        Returns: unknown;
      };
      update_delivery_fields: {
        Args: {p_task_id: string;
  p_delivery_summary: string;
  p_delivery_md: string;
  p_delivery_files_list: string[];};
        Returns: unknown;
      };
      update_wallet_timestamp: {
        Args: {};
        Returns: unknown;
      };
      validate_delivery_files: {
        Args: {p_bid_id: string;
  p_file_ids: string[];};
        Returns: unknown;
      };
      validate_delivery_files_trigger: {
        Args: {};
        Returns: unknown;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

// Type helpers
type PublicSchema = Database[Extract<keyof Database, "public">];

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never;
