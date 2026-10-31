/*
 * THE SUMMIT OPENING WEARS THE PERSON'S OWN SKIN (S16, 31 Oct). Stephan, having picked Platinum: "make examples with the
 * other pictures like africa and stuff". So Summit flares over the photograph of whichever skin this browser wears --
 * the baobabs for Africa, the dune for Desert -- with the same silver lines and gold wing on every one. `sun` is where
 * the light is in each photograph (percent across, percent down, at a centred cover crop), which is where the flare
 * goes; a skin with no photograph of its own (Current) gets Raptor's mountain.
 */
export interface OpeningPhoto { id: string; name: string; src: string; sun: [number, number] }

export const OPENING_PHOTOS: OpeningPhoto[] = [
  { id: 'raptor', name: 'Raptor', src: '/brand/raptor-login.webp', sun: [41, 28] },
  { id: 'africa', name: 'Africa', src: '/brand/africa-hero.webp', sun: [9, 46] },
  { id: 'desert', name: 'Desert', src: '/brand/desert-hero.webp', sun: [22, 18] },
  { id: 'forest', name: 'Forest', src: '/brand/forest-hero.webp', sun: [24, 16] },
  { id: 'ocean', name: 'Ocean', src: '/brand/ocean-hero.webp', sun: [55, 30] },
  { id: 'glass-mountain', name: 'Glass mountain', src: '/brand/glass-mountain-bg.jpg', sun: [94, 26] },
]

/** The photograph for a skin id (the html element's data-theme), Raptor's mountain when the skin has none. */
export function openingPhotoFor(themeId: string | null | undefined): OpeningPhoto {
  return OPENING_PHOTOS.find((p) => p.id === themeId) ?? OPENING_PHOTOS[0]
}
