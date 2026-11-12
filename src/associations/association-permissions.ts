/**
 * Permissão do portal de parceiros por associação.
 * Novo slug `{foo}` → conceder `associacao.foo.parceiros` no grupo do usuário (seed ou criação automática no admin).
 */
export function associationPartnersPermissionKey(slug: string): string {
  return `associacao.${slug.trim().toLowerCase()}.parceiros`;
}
