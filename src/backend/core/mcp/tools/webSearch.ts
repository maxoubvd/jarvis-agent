export async function webSearch(query: string): Promise<string> {
  return `Erreur: Outil de recherche web non configuré. Impossible de rechercher "${query}". Demande à l'utilisateur de fournir l'information.`;
}
