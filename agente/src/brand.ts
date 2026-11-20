// Identidad de la app en un solo lugar. Para renombrar: cambiar aquí, en index.html, manifest, capacitor.config.json y brand/*.svg
export const BRAND = { name: 'Atalaya', tagline: 'Tu negocio, a la vista.', by: 'Impulsor' } as const;

/** Funciones listas en el código pero apagadas hasta activarlas en el servidor (WhatsApp requiere cuenta de Meta y migraciones 0002/0004). */
export const FEATURES = { whatsapp: import.meta.env.VITE_FEATURE_WHATSAPP === '1' } as const;
