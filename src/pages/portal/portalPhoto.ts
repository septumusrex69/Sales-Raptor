/*
 * THE PORTAL'S PHOTOGRAPH (S16, 31 Oct). Until now the sign-in, the dashboard band and the room behind the sign-in card
 * all used remittance-cover.jpg -- a 1 672 x 609 strip -- and on an iPad the tall sign-in panel blew it up four times.
 * Stephan, the third time: "there needs to be a good quality picture". No larger original exists, so this is a real
 * high-resolution photograph from Unsplash, his pick of six (31 Oct, "Use the first one"): Llandudno at sunset, Cape
 * Town, 5 842 x 3 895, by Byron Breytenbach.
 *
 * LOADED FROM UNSPLASH, NOT COPIED INTO THE APP, which is how Unsplash asks its photographs to be used: their image
 * service sizes it for each place (`w`), so the iPad gets 3 200 pixels and the blurred room behind the card 1 200. The
 * download was registered with Unsplash when it was chosen, and the photographer is credited on the page (PORTAL_PHOTO
 * .credit). If Unsplash cannot be reached, each place falls back to the old strip, so a client never sees a blank panel.
 */
const BASE = 'https://images.unsplash.com/photo-1583654646893-b89ba9d3849c'

export const PORTAL_PHOTO = {
  id: 'eU6Da03AsUQ',
  credit: {
    name: 'Byron Breytenbach',
    profile: 'https://unsplash.com/@ohdiehard?utm_source=raptor&utm_medium=referral',
    unsplash: 'https://unsplash.com/?utm_source=raptor&utm_medium=referral',
  },
}

/** The photograph sized for a place, `width` pixels wide, with the old strip underneath in case it cannot load. */
export function portalPhotoLayer(width: number, position = 'center', fallback = '/brand/portal-signin.webp'): string {
  return `url('${BASE}?ixlib=rb-4.1.0&auto=format&fit=max&q=82&w=${width}') ${position} / cover no-repeat, url('${fallback}') ${position} / cover no-repeat`
}
