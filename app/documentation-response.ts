export async function readDocumentationResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    const payload: unknown = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid response");
    return payload as T;
  } catch {
    if (response.status === 401 || response.redirected) {
      throw new Error("Sesiunea a expirat. Autentifică-te din nou pentru a salva execuția.");
    }
    throw new Error(`Serverul a returnat un răspuns neașteptat (HTTP ${response.status}). Salvarea nu a putut fi confirmată. Reîncarcă tichetul pentru a verifica dacă execuția a fost salvată înainte de a reîncerca.`);
  }
}
