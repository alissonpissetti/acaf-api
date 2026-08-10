export interface DatabaseConfig {
  type: 'mariadb';
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export function parseDatabaseUrl(url: string): DatabaseConfig {
  const parsed = new URL(url);
  return {
    type: 'mariadb',
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
  };
}
