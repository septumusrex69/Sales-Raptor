/*
 * THE PORTAL'S PHOTOGRAPH (S16, 31 Oct). Until now the sign-in, the dashboard band and the room behind the sign-in card
 * all used remittance-cover.jpg -- a 1 672 x 609 strip -- and on an iPad the tall sign-in panel blew it up four times.
 * Stephan, the third time: "there needs to be a good quality picture". No larger original existed, so it is a real
 * photograph from Unsplash, his pick of six ("Use the first one"): Llandudno at sunset, Cape Town, by Byron
 * Breytenbach (photo eU6Da03AsUQ; the download registered with Unsplash when it was chosen).
 *
 * OUR OWN COPY, NOT A LINK TO THEIRS. For a few minutes it was loaded straight from Unsplash, because this session
 * could not download it; Stephan: "Didn't we download it? ... It's a safer way" -- so he downloaded it and sent it,
 * and it lives in the app (public/brand/portal-photo.webp, 2 576 x 1 717): no dependence on Unsplash staying up, and
 * the remittance advice's cover (remittance-cover.jpg) is cut from the same file. 1 717 pixels tall is enough for the
 * iPad's tall sign-in panel (about 1 520 device pixels) without stretching. The photographer is still credited on the
 * page (PORTAL_PHOTO.credit) -- Unsplash's licence does not require it, and it is the decent thing.
 */
export const PORTAL_PHOTO = {
  src: '/brand/portal-photo.webp',
  credit: {
    name: 'Byron Breytenbach',
    profile: 'https://unsplash.com/@ohdiehard?utm_source=raptor&utm_medium=referral',
    unsplash: 'https://unsplash.com/?utm_source=raptor&utm_medium=referral',
  },
}

/** The photograph as a CSS background layer, framed at `position` (the bay and the mountain sit left of centre). */
export function portalPhotoLayer(position = '38% center'): string {
  return `url('${PORTAL_PHOTO.src}') ${position} / cover no-repeat`
}
