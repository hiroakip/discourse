import GlimmerComponent from "discourse/components/glimmer";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import I18n from "I18n";

function coreComponentForType() {
  return {
    granted_badge: "user-menu/granted-badge-notification-item",
    liked: "user-menu/liked-notification-item",
    liked_consolidated: "user-menu/liked-consolidated-notification-item",
    bookmark_reminder: "user-menu/bookmark-reminder-notification-item",
    custom: "user-menu/custom-notification-item",
    group_message_summary: "user-menu/group-message-summary-notification-item",
    invitee_accepted: "user-menu/invitee-accepted-notification-item",
    membership_request_accepted:
      "user-menu/membership-request-accepted-notification-item",
  };
}

let _componentForType = coreComponentForType();

export function registerCustomComponentForType(notificationType, component) {
  _componentForType[notificationType] = component;
}

export function resetComponentForType() {
  _componentForType = coreComponentForType();
}

export default class UserMenuNotificationsList extends GlimmerComponent {
  @tracked loading = false;
  @tracked items = [];

  constructor() {
    super(...arguments);
    this.fetchNotifications();
  }

  get filterByType() {
    return null;
  }

  fetchNotifications() {
    this.loading = true;

    const params = {
      recent: true,
      silent: this.currentUser.enforcedSecondFactor,
      limit: 30,
    };
    let cacheKey = "recent-notifications";
    if (this.filterByType) {
      params.filter_by_type = this.filterByType;
      cacheKey += `-type-${this.filterByType}`;
    }

    this.store
      .findStale("notification", params, { cacheKey })
      .refresh()
      .then((data) => {
        this.items = data.content.map((notification) => {
          const name = this.site.notificationLookup[
            notification.notification_type
          ];
          if (_componentForType[name]) {
            return {
              ...notification,
              component: _componentForType[name],
            };
          } else {
            return notification;
          }
        });
        return this.items;
      })
      .finally(() => {
        this.loading = false;
      });
  }

  get showAllHref() {
    return `${this.currentUser.path}/notifications`;
  }

  get showAllTitle() {
    return I18n.t("user_menu.view_all_notifications");
  }

  get dismissTitle() {
    return I18n.t("user.dismiss_notifications_tooltip");
  }

  get showDismiss() {
    return this.items.some((item) => !item.read);
  }

  @action
  dismissButtonClick() {
    console.log("do something");
  }
}
