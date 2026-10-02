import {
  Activity, Archive, Bell, BookOpen, Building2, CalendarDays, CalendarRange, ChartLine, ClipboardList,
  FileBarChart, FileText, History, Inbox, LayoutDashboard, Library, ListChecks, Package, Palette, Ruler,
  ScanSearch, Settings, ShieldCheck, Stamp, Tags, UsersRound, Circle, GraduationCap, Upload, School, CalendarClock, Route, DoorOpen,
  Presentation, Percent, ClipboardCheck, Ticket, Award, PenLine, RefreshCcw, Wallet, Banknote, Briefcase, CalendarOff, UserCheck, Contact, FlaskConical, BadgeCheck, Megaphone, LifeBuoy, BedDouble, Bus, UserPlus, Landmark, Target, LogOut, FileCheck, LockKeyhole, Bot, Scale, IdCard, HeartHandshake, ShoppingCart, Boxes, Monitor, PiggyBank, CalendarCheck, ShieldHalf, Stethoscope, DoorClosed, type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  activity: Activity, archive: Archive, bell: Bell, "book-open": BookOpen, "building-2": Building2,
  "calendar-days": CalendarDays, "calendar-range": CalendarRange, "chart-line": ChartLine,
  "clipboard-list": ClipboardList, "file-bar-chart": FileBarChart, "file-text": FileText, history: History,
  inbox: Inbox, "layout-dashboard": LayoutDashboard, library: Library, "list-checks": ListChecks,
  package: Package, palette: Palette, ruler: Ruler, "scan-search": ScanSearch, settings: Settings,
  "shield-check": ShieldCheck, stamp: Stamp, tags: Tags, "users-round": UsersRound, "graduation-cap": GraduationCap, upload: Upload,
  school: School, "calendar-clock": CalendarClock, route: Route, "door-open": DoorOpen, presentation: Presentation, percent: Percent,
  "clipboard-check": ClipboardCheck, ticket: Ticket, award: Award, "pen-line": PenLine, "refresh-ccw": RefreshCcw, wallet: Wallet, banknote: Banknote,
  briefcase: Briefcase, flask: FlaskConical, "badge-check": BadgeCheck, megaphone: Megaphone, "life-buoy": LifeBuoy, bed: BedDouble, bus: Bus, "user-plus": UserPlus, "calendar-off": CalendarOff, "user-check": UserCheck, contact: Contact,
  landmark: Landmark, target: Target, "log-out": LogOut, "file-check": FileCheck, "lock-keyhole": LockKeyhole, bot: Bot, scale: Scale, "id-card": IdCard, "heart-handshake": HeartHandshake,
  cart: ShoppingCart, boxes: Boxes, monitor: Monitor, "piggy-bank": PiggyBank, "calendar-check": CalendarCheck, shield: ShieldHalf, stethoscope: Stethoscope, "door-closed": DoorClosed,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = MAP[name] ?? Circle;
  return <Icon aria-hidden className={className} />;
}
