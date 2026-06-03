export interface IMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

export interface IContact {
  profile: { name: string };
  wa_id: string;
}

export interface IMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

export interface IStatus {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
}

export interface IValue {
  messaging_product: string;
  metadata: IMetadata;
  contacts?: IContact[];
  messages?: IMessage[];
  statuses?: IStatus[];
}

export interface IChange {
  value: IValue;
  field: string;
}

export interface IEntry {
  id: string;
  changes: IChange[];
}

export interface IWebhookPayload {
  object: string;
  entry: IEntry[];
}
