export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  webhookSecret: string;
  myPhoneNumber: string;
}

export interface AiConfig {
  provider: string;
  geminiApiKey: string;
  anthropicApiKey: string;
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  whatsapp: WhatsAppConfig;
  ai: AiConfig;
}

export default (): AppConfig => ({
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  databaseUrl: process.env['DATABASE_URL'] ?? '',
  whatsapp: {
    phoneNumberId: process.env['WA_PHONE_NUMBER_ID'] ?? '',
    accessToken: process.env['WA_ACCESS_TOKEN'] ?? '',
    verifyToken: process.env['WA_VERIFY_TOKEN'] ?? '',
    webhookSecret: process.env['WA_WEBHOOK_SECRET'] ?? '',
    myPhoneNumber: process.env['MY_WA_NUMBER'] ?? '',
  },
  ai: {
    provider: process.env['AI_PROVIDER'] ?? 'gemini',
    geminiApiKey: process.env['GEMINI_API_KEY'] ?? '',
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'] ?? '',
  },
});
