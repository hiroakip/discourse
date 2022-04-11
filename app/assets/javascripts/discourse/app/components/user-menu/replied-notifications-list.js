import UserMenuNotificationsList from "discourse/components/user-menu/notifications-list";

export default class UserMenuRepliedNotificationsList extends UserMenuNotificationsList {
  get filterByType() {
    return "replied";
  }
}
