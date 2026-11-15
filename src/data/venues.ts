// Venues and menus as data rows. Hours are minutes after midnight of the game day; a
// close time past 1440 means after midnight. Prices and durations are balancing
// placeholders, not real menus.
import { N } from './names';

export interface MenuItem {
  id: string;
  name: string;
  price: number;      // dollars; ignored when swipe is true
  swipe?: boolean;    // paid with a meal swipe
  minutes: number;
  hunger: number;     // negative fills you up
  energy: number;
  stress: number;
  bucket?: string;
  flag?: string;
}

export interface Venue { id: string; name: string; open: number; close: number; items: MenuItem[] }

const h = (hh: number, mm = 0) => hh * 60 + mm;
const T = N.talley;

const swipeMeal = (id: string): MenuItem => ({
  id: `${id}-meal`, name: 'All-you-care-to-eat meal', price: 0, swipe: true, minutes: 30, hunger: -60, energy: 6, stress: -3,
});

const LIST: Venue[] = [
  { id: 'outfitters', name: T.outfitters, open: h(8), close: h(19), items: [
    { id: 'hoodie', name: 'Red hoodie', price: 45, minutes: 10, hunger: 0, energy: 0, stress: -6, flag: 'hoodie' },
    { id: 'notebook', name: 'Graph-paper notebook', price: 4, minutes: 5, hunger: 0, energy: 0, stress: -1, flag: 'notebook' },
  ] },
  { id: 'market', name: T.market, open: h(7), close: h(24), items: [
    { id: 'granola', name: 'Granola bar', price: 2, minutes: 5, hunger: -10, energy: 2, stress: 0 },
    { id: 'noodles', name: 'Cup noodles', price: 2.5, minutes: 10, hunger: -20, energy: 0, stress: 0 },
    { id: 'energy', name: 'Energy drink', price: 3.5, minutes: 5, hunger: 0, energy: 15, stress: 3 },
    { id: 'paint', name: 'Spray paint (tunnel-safe)', price: 6, minutes: 5, hunger: 0, energy: 0, stress: 0, flag: 'paint' },
  ] },
  { id: 'howlingcow', name: T.howlingCow, open: h(11), close: h(21), items: [
    { id: 'scoop', name: 'Scoop of ice cream', price: 4, minutes: 10, hunger: -10, energy: 2, stress: -8, bucket: 'howlingcow' },
  ] },
  { id: 'pcj', name: T.pcj, open: h(7), close: h(20), items: [
    { id: 'drip', name: 'Drip coffee', price: 3.5, minutes: 10, hunger: 0, energy: 15, stress: 0 },
    { id: 'latte', name: 'Latte', price: 5, minutes: 10, hunger: -3, energy: 15, stress: -3 },
    { id: 'muffin', name: 'Blueberry muffin', price: 3, minutes: 10, hunger: -15, energy: 3, stress: 0 },
  ] },
  { id: 'tuffys', name: T.tuffys, open: h(10, 30), close: h(21), items: [
    { id: 'burger', name: 'Burger and fries', price: 9, minutes: 30, hunger: -50, energy: 4, stress: -3 },
    { id: 'shake', name: 'Milkshake', price: 5, minutes: 15, hunger: -15, energy: 0, stress: -6 },
  ] },
  { id: 'loslobos', name: T.losLobos, open: h(11), close: h(20), items: [
    { id: 'bowl', name: 'Burrito bowl', price: 10, minutes: 30, hunger: -55, energy: 4, stress: -2 },
  ] },
  { id: 'oneearth', name: T.oneEarth, open: h(11), close: h(20), items: [
    { id: 'grain', name: 'Grain bowl', price: 9, minutes: 30, hunger: -45, energy: 8, stress: -2 },
  ] },
  { id: 'jasons', name: T.jasons, open: h(10, 30), close: h(20), items: [
    { id: 'sandwich', name: 'Sandwich', price: 9, minutes: 25, hunger: -45, energy: 3, stress: -1 },
    { id: 'soup', name: 'Cup of soup', price: 6, minutes: 20, hunger: -30, energy: 2, stress: -2 },
  ] },
  { id: 'sushi', name: T.sushi, open: h(11), close: h(19), items: [
    { id: 'roll', name: 'Sushi roll', price: 11, minutes: 20, hunger: -40, energy: 5, stress: -2 },
  ] },
  { id: 'starbucks', name: T.starbucks, open: h(7, 30), close: h(22), items: [
    { id: 'coldbrew', name: 'Cold brew', price: 4.5, minutes: 10, hunger: 0, energy: 18, stress: 1 },
    { id: 'frap', name: 'Blended drink', price: 6, minutes: 10, hunger: -8, energy: 10, stress: -5 },
  ] },
  { id: 'fountain', name: N.bldg.fountain, open: h(7), close: h(21), items: [swipeMeal('fountain')] },
  { id: 'clark', name: N.bldg.clark, open: h(7), close: h(21), items: [swipeMeal('clark')] },
  { id: 'case', name: N.bldg.caseDining, open: h(7), close: h(20), items: [swipeMeal('case')] },
  { id: 'brickline', name: N.hillsboroughVenues[1], open: h(11), close: h(26), items: [
    { id: 'slice', name: 'Two slices', price: 6, minutes: 20, hunger: -30, energy: 2, stress: -2 },
    { id: 'pie', name: 'Sit-down pizza dinner', price: 14, minutes: 45, hunger: -60, energy: 3, stress: -8 },
  ] },
  { id: 'nightowl', name: N.hillsboroughVenues[3], open: h(17), close: h(26), items: [
    { id: 'ramen', name: 'Late-night ramen', price: 12, minutes: 45, hunger: -55, energy: 3, stress: -7 },
  ] },
];

export const VENUES: Record<string, Venue> = Object.fromEntries(LIST.map((v) => [v.id, v]));
export const DINING_HALLS = ['fountain', 'clark', 'case'];
