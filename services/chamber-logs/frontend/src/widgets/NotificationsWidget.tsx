import { useNavigate } from "react-router-dom";
import { NotificationBell } from "../components/NotificationBell";

// This Chamber's 1x1 homepage widget - the one place the bell+panel lives
// now (see NotificationBell's own comment), in place of the old
// Capitol-header-mounted version. useNavigate here resolves against
// whichever Router this widget is mounted under - Capitol's own when
// shell-hosted on the canvas (the only place this widget ever actually
// renders), same as any other widget's navigation.
export function NotificationsWidget() {
  const navigate = useNavigate();

  return (
    <div className="flex h-full w-full items-center justify-center">
      <NotificationBell ownChamber="logs" navigate={(path) => navigate(path)} />
    </div>
  );
}
