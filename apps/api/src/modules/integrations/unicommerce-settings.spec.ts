import { resolveUnicommerceSettings } from './unicommerce.client';

const from = (env: Record<string, string>) => resolveUnicommerceSettings((k) => env[k]);

describe('Unicommerce settings', () => {
  it('reads the operator block as given', () => {
    const s = from({
      UC_BASE_URL: 'https://uc-proxy.example.test/uc/', UC_AUTH_HEADER: 'x-proxy-secret', UC_PROXY_SECRET: 'abc',
      UC_READ_ENABLED: 'true', UC_WRITE_ENABLED: 'true', UC_WRITE_CONFIRMATION_REQUIRED: 'true',
    });
    expect(s).toEqual({
      enabled: true, baseUrl: 'https://uc-proxy.example.test/uc', proxySecret: 'abc', proxyHeader: 'x-proxy-secret',
      writeSwitch: true, writeConfirmationRequired: true, allowExternalWrites: true,
    });
  });

  it('prefers UC_* over the original names, and falls back to them', () => {
    expect(from({ UC_BASE_URL: 'https://new/uc', UNICOMMERCE_BASE_URL: 'http://old/uc' }).baseUrl).toBe('https://new/uc');
    expect(from({ UNICOMMERCE_BASE_URL: 'http://old/uc', UNICOMMERCE_ENABLED: 'true' })).toMatchObject({ baseUrl: 'http://old/uc', enabled: true });
    expect(from({ INTEGRATION_ALLOW_EXTERNAL_WRITES: 'true' }).allowExternalWrites).toBe(true);
    expect(from({ UC_WRITE_ENABLED: 'false', INTEGRATION_ALLOW_EXTERNAL_WRITES: 'true' }).allowExternalWrites).toBe(false);
  });

  it('keeps writes off unless explicitly on', () => {
    expect(from({}).allowExternalWrites).toBe(false);
    expect(from({ UC_WRITE_ENABLED: 'yes' }).allowExternalWrites).toBe(false);
  });

  it('refuses to write if confirmation is switched off', () => {
    const s = from({ UC_WRITE_ENABLED: 'true', UC_WRITE_CONFIRMATION_REQUIRED: 'false' });
    expect(s).toMatchObject({ writeSwitch: true, writeConfirmationRequired: false, allowExternalWrites: false });
  });

  it('falls back to the standard header for a malformed name', () => {
    expect(from({ UC_AUTH_HEADER: 'x-proxy secret\nInjected: 1' }).proxyHeader).toBe('X-Proxy-Secret');
  });
});
