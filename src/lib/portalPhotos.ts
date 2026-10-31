/*
 * THE PORTAL'S PHOTOGRAPH, A NEW ONE OF SOUTH AFRICA EVERY DAY (S16, 31 Oct).
 *
 * How it got here. The sign-in, the dashboard band and the room behind the sign-in card all used remittance-cover.jpg, a
 * 1 672 x 609 strip the iPad's tall panel blew up four times ("there needs to be a good quality picture", the third time).
 * Llandudno at sunset replaced it -- Stephan downloaded it and sent it, so it is OURS (public/brand/portal-photo.webp,
 * "It's a safer way"). Then, of the board of South African candidates at /portal/photos: "I really like the photos ...
 * can we have like a new photo of South Africa ... every single day?"
 *
 * THE DAY DECIDES, NOT THE PERSON. photoOfTheDay counts whole days in Johannesburg since a fixed start and walks the
 * rotation, so every client sees the same photograph on the same day, a new one at midnight, and every one of them
 * before any repeats. Derived, never stored: no job to run, nothing to forget.
 *
 * WHERE EACH ONE COMES FROM. Llandudno is the app's own copy. The others load from Unsplash at the size each place
 * needs, because this session could not download them (the container's network refuses images.unsplash.com); each
 * carries Llandudno underneath, so a day Unsplash cannot be reached shows Llandudno rather than a blank panel. When the
 * network allows it, each gets `local` like Llandudno and nothing else changes. The photographer is credited on the page
 * for whichever is showing.
 *
 * THE MIX (31 Oct, after seeing the people and the cities: "move the nature to 40 ... 35 other ... twenty-five city"):
 * 10 nature, 8 people, 6 city, all South African. The remittance advice does not rotate: an advice is a document, and two copies of one should look alike.
 */
export type PortalPhotoKind = 'Nature' | 'City' | 'People'

export interface PortalPhoto {
  /** Unsplash's id for the photograph (its page is unsplash.com/photos/<id>). */
  id: string
  /** The image path on images.unsplash.com. */
  photo: string
  kind: PortalPhotoKind
  title: string
  place: string
  by: string
  /** The photographer's Unsplash username, for the credit's link. */
  user: string
  size: string
  /** Where the band (wide and short) frames it; the sign-in (tall) is centred. */
  band?: string
  /** The app's own copy, when there is one. */
  local?: string
  /*
   * A LINE TO GO WITH IT (31 Oct; Stephan: "say something nice ... cool stuff about South Africa ... inspirational ...
   * quote from good people ... stuff of power. Things that build people, things that drive people"). A quote carries
   * `who`; a line of the firm's own about the place has none. ONLY QUOTES ON GOOD AUTHORITY: the internet credits
   * Mandela, Einstein and Churchill with a great deal they never said, and a misquote on a firm's portal is the kind of
   * small carelessness clients notice. The facts in the firm's own lines are checked (Table Mountain's sandstone is
   * hundreds of millions of years older than the Himalayas; the Drakensberg basalt is about 180 million years old;
   * Johannesburg and the Witwatersrand gold rush both date from 1886; the Cape Floral Kingdom is the smallest of six).
   */
  line: string
  who?: string
}

export const PORTAL_PHOTOS: PortalPhoto[] = [
  /* NATURE -- about 40% (Stephan, 31 Oct: "move the nature to 40 ... 35 [people] ... 25 city"). */
  { id: 'W0tOuiKeyXU', photo: 'photo-1570003448157-b20009be4ba4', kind: 'Nature', title: 'An old bull elephant', place: 'South Africa', by: 'Ante Hamersmit', user: 'ante_kante', size: '4608 × 2592', line: 'I learned that courage was not the absence of fear, but the triumph over it.', who: 'Nelson Mandela' },
  { id: 'eU6Da03AsUQ', photo: 'photo-1583654646893-b89ba9d3849c', kind: 'Nature', title: 'Llandudno at sunset', place: 'Cape Town', by: 'Byron Breytenbach', user: 'ohdiehard', size: '5842 × 3895', band: 'center 46%', local: '/brand/portal-photo.webp', line: 'Where two oceans meet the mountains, the day ends in gold. Finish yours the same way.' },
  { id: 'bUOMCTiUymE', photo: 'photo-1507274274451-b203cf128a8f', kind: 'Nature', title: 'The Three Rondavels at dusk', place: 'Blyde River Canyon, Mpumalanga', by: 'Matthias Mullie', user: 'matthiasmullie', size: '6932 × 2772', line: 'After climbing a great hill, one only finds that there are many more hills to climb.', who: 'Nelson Mandela' },
  { id: 'YMJUpl8YWnE', photo: 'photo-1658095513380-258816ec8e85', kind: 'Nature', title: 'A zebra and her foal', place: 'Kruger National Park', by: 'Simona Marinkova', user: 'zhenomad', size: '6000 × 4000', line: 'Strength is passed on. What you build today, someone carries tomorrow.' },
  { id: 'bWE2CLXU0bM', photo: 'photo-1645777762248-cd62e0c9149a', kind: 'Nature', title: 'The canyon and its river', place: 'Blyde River Canyon, Mpumalanga', by: 'Asher Pardey', user: 'asherpardey', size: '6401 × 4267', line: 'The impediment to action advances action. What stands in the way becomes the way.', who: 'Marcus Aurelius' },
  { id: 'qqIOlje2b9g', photo: 'photo-1566840021279-9713abd97c05', kind: 'Nature', title: 'A tarn below Devil\'s Knuckles', place: 'Southern Drakensberg, KwaZulu-Natal', by: 'Arthur Hickinbotham', user: 'arthurhick', size: '5184 × 2912', line: 'The Drakensberg has stood for 180 million years. Build things that last.' },
  { id: 'L6EP96_w1Fc', photo: 'photo-1563656157432-67560011e209', kind: 'Nature', title: 'Table Mountain from the beach at sunset', place: 'Cape Town', by: 'Brent Ninaber', user: 'brentninaber', size: '4800 × 2700', line: 'Table Mountain is older than the Himalayas. Patience builds mountains.' },
  { id: '9VTU2GoJPcg', photo: 'photo-1566840021286-b26a2e522c7e', kind: 'Nature', title: 'Thaba Ntsu', place: 'Southern Drakensberg, KwaZulu-Natal', by: 'Arthur Hickinbotham', user: 'arthurhick', size: '5184 × 2912', line: 'Life is like riding a bicycle. To keep your balance, you must keep moving.', who: 'Albert Einstein' },
  { id: 'i1el7Rtl-UY', photo: 'photo-1730234350694-1f8716098f8a', kind: 'Nature', title: 'Oudekraal and the Twelve Apostles', place: 'Cape Town', by: 'Martijn Vonk', user: 'vonkm737', size: '6000 × 4000', line: 'Not all those who wander are lost.', who: 'J.R.R. Tolkien, born in Bloemfontein' },
  { id: 'JE56S222Rw0', photo: 'photo-1580644906000-6e953181e153', kind: 'Nature', title: 'Fynbos in flower on the mountain', place: 'Table Mountain, Cape Town', by: 'Tobias Reich', user: 'electerious', size: '6000 × 4000', line: 'The Cape Floral Kingdom is the smallest of the world\'s six, and the richest. Size was never the point.' },
  /* PEOPLE -- about a third. */
  { id: 'l_YNobbDYJk', photo: 'photo-1497271679421-ce9c3d6a31da', kind: 'People', title: 'People of Mamelodi', place: 'Pretoria', by: 'Mpumelelo Macu', user: 'mpumelelomacu', size: '4175 × 2783', line: 'Do what you can, with what you have, where you are.', who: 'Theodore Roosevelt' },
  { id: 'FnrFx_UMebQ', photo: 'photo-1580737123512-b720ac34049a', kind: 'People', title: 'The Neighbourgoods Market', place: 'Cape Town', by: 'Sebastian Canaves', user: 'offthepath', size: '6720 × 4480', line: 'Every great business started at a table like this one: someone selling, someone buying, both coming back.' },
  { id: '3OOulcwrvr4', photo: 'photo-1565206019928-834faeacc5d2', kind: 'People', title: 'Soweto dreamers', place: 'Soweto', by: 'Naba Abolova', user: 'naba_abolova', size: '6000 × 4000', line: 'When something is important enough, you do it even if the odds are not in your favour.', who: 'Elon Musk, born in Pretoria' },
  { id: '47WZ2X0AtIg', photo: 'photo-1516273766481-41f278b6d72f', kind: 'People', title: 'Sunset from Lion\'s Head', place: 'Cape Town', by: 'Nadine Hondebrink', user: 'nhondebrink', size: '5472 × 3648', line: 'It\'s the job that\'s never started as takes longest to finish.', who: 'J.R.R. Tolkien' },
  { id: 'n9UQCavpuE4', photo: 'photo-1595239094961-6920b281336a', kind: 'People', title: 'A happy moment', place: 'Johannesburg', by: 'Nqobile Vundla', user: 'nqoe', size: '5000 × 3334', line: 'Good work, done honestly, is something to smile about.' },
  { id: '2SDg8RmOfVg', photo: 'photo-1504293424273-dd6b2465e6b5', kind: 'People', title: 'Skating the city', place: 'Johannesburg', by: 'Keenan Constance', user: 'keenangrams', size: '2738 × 1825', line: 'Balance, speed and nerve. The city rewards all three.' },
  { id: 'hqvWruD-834', photo: 'photo-1607862942389-0c0de421ea28', kind: 'People', title: 'Kasi style', place: 'Soweto', by: 'Naba Abolova', user: 'naba_abolova', size: '6000 × 4000', line: 'Use what is in front of you and make it work. That is the South African way.' },
  { id: 'axTLYW8opeU', photo: 'photo-1610722838579-e5c518249361', kind: 'People', title: 'A smile', place: 'Gauteng', by: 'Steward Masweneng', user: 'stewardesign', size: '4928 × 3264', line: 'We can achieve anything if we work together as one.', who: 'Siya Kolisi, Springbok captain, 2019' },
  /* CITY -- about a quarter. */
  { id: 'iAsUCcNUpGI', photo: 'photo-1604348489791-f95132c5d8c0', kind: 'City', title: 'Joburg skyline at dawn', place: 'Johannesburg', by: 'Steffen Lemmerzahl', user: 'steffen_l', size: '5368 × 3579', line: 'Egoli, the city of gold, was built by people who got up before the sun.' },
  { id: 'fx0V31EtZls', photo: 'photo-1679128991854-77953a560856', kind: 'City', title: 'Sea Point from Lion\'s Head at sunset', place: 'Cape Town', by: 'Waldo Piater', user: 'waldopiater', size: '4608 × 3072', line: 'Let us live and strive for freedom, in South Africa our land.', who: 'Nkosi Sikelel\' iAfrika' },
  { id: '_h-L45TSmGM', photo: 'photo-1636706519609-988babca3dd5', kind: 'City', title: 'Johannesburg at golden hour', place: 'Johannesburg', by: 'Simon Hurry', user: 'bullterriere', size: '5186 × 3140', line: 'Johannesburg was a goldfield in 1886. Look at it now. Start somewhere.' },
  { id: 'rfQwBKfG0xE', photo: 'photo-1656776832783-c1671a7ad521', kind: 'City', title: 'Durban across the water', place: 'Durban', by: 'Weyland Swart', user: 'weylandswart', size: '5184 × 3456', line: 'Warm water, hard work and early mornings. Durban knows how to do a day.' },
  { id: 'C_cOkO1AO4w', photo: 'photo-1668533530587-b01d25dd90a2', kind: 'City', title: 'Simmonds Street', place: 'Johannesburg', by: 'Ngcali Alexa Magopeni', user: 'alexa_thecreative', size: '4128 × 2322', line: 'Every tower on this street was a plan on paper first.' },
  { id: 'h5aF8jYW5XU', photo: 'photo-1747558510377-2b383597e1d1', kind: 'City', title: 'Durban from North Beach pier', place: 'Durban', by: 'Marlin Clark', user: 'marlinclark', size: '5184 × 3500', line: 'End the day better than you started it.' },
]

/*
 * THE ROTATION: every photograph, the three kinds SPREAD through it rather than in runs -- each kind's photographs are
 * placed at even intervals across the cycle (the n-th of k at (n + 0.5) / k), so a fortnight of mountains never comes
 * before a week of streets. The elephant opens it (Stephan, 31 Oct: "For today ... start with the elephant").
 */
function spread(photos: PortalPhoto[]): PortalPhoto[] {
  const at = new Map<PortalPhoto, number>()
  for (const kind of ['Nature', 'People', 'City'] as const) {
    const ofKind = photos.filter((p) => p.kind === kind)
    ofKind.forEach((p, i) => at.set(p, (i + 0.5) / ofKind.length + (kind === 'Nature' ? -0.001 : kind === 'People' ? 0 : 0.001)))
  }
  return [...photos].sort((a, b) => (at.get(a) as number) - (at.get(b) as number))
}
export const PORTAL_ROTATION: PortalPhoto[] = spread(PORTAL_PHOTOS)

const FALLBACK = '/brand/portal-photo.webp'
/* The day the rotation counts from: 31 Oct 2026, the elephant's day. */
const START = Date.UTC(2026, 9, 31)

/** The photograph for a Johannesburg day (yyyy-mm-dd): the same for everyone that day, the next one tomorrow. */
export function photoOfTheDay(day: string): PortalPhoto {
  const [y, m, d] = day.split('-').map(Number)
  const days = Math.round((Date.UTC(y, m - 1, d) - START) / 86_400_000)
  const n = PORTAL_ROTATION.length
  return PORTAL_ROTATION[((days % n) + n) % n]
}

/** The photograph's address at a width; the app's own copy where there is one. */
export function portalPhotoUrl(p: PortalPhoto, width: number): string {
  return p.local ?? `https://images.unsplash.com/${p.photo}?ixlib=rb-4.1.0&auto=format&fit=max&q=80&w=${width}`
}

/** As a CSS background: the photograph framed at `position`, with Llandudno underneath for a day Unsplash fails. */
export function portalPhotoLayer(p: PortalPhoto, width: number, position = 'center'): string {
  const own = `url('${portalPhotoUrl(p, width)}') ${position} / cover no-repeat`
  return p.local ? own : `${own}, url('${FALLBACK}') center / cover no-repeat`
}

export function photoCredit(p: PortalPhoto) {
  return {
    name: p.by,
    profile: `https://unsplash.com/@${p.user}?utm_source=raptor&utm_medium=referral`,
    unsplash: 'https://unsplash.com/?utm_source=raptor&utm_medium=referral',
  }
}

/**
 * A moment's day in Johannesburg, yyyy-mm-dd -- the rotation's day. The CALLER passes the moment: a browser passes
 * clockNow() (so the staging clock moves the photograph with everything else), the server passes the real time. This
 * file reads no clock of its own (check-staging-clock).
 */
export function johannesburgToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** A small copy of the day's photograph, to ask whether Unsplash is serving it (the dashboards' and the server's check). */
export function portalPhotoProbe(p: PortalPhoto): string {
  return portalPhotoUrl({ ...p, local: undefined }, 64)
}
