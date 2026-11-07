// Type declarations for Deno runtime in Supabase Edge Functions
// This resolves editor TypeScript warnings when Deno extension is not installed.

declare namespace Deno {
  export const env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
  };
  export function serve(handler: (req: Request) => Promise<Response> | Response): void;
}

declare module "https://*" {
  const content: any;
  export default content;
  export const createClient: any;
}

