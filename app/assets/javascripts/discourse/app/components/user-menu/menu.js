import GlimmerComponent from "discourse/components/glimmer";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";

const DefaultTabId = "all-notifications";
const DefaultPanelComponent = "user-menu/notifications-list";

export default class UserMenu extends GlimmerComponent {
  @tracked currentTabId = DefaultTabId;
  @tracked currentPanelComponent = DefaultPanelComponent;

  get topTabs() {
    // TODO: handle keyboard navigation, see commit 5276d43
    return this._coreTopTabs.map((tab, index) => {
      tab.position = index;
      return tab;
    });
  }

  get bottomTabs() {
    const topTabsLength = this.topTabs.length;
    return this._coreBottomTabs.map((tab, index) => {
      tab.position = index + topTabsLength;
      return tab;
    });
  }

  get _coreTopTabs() {
    return [
      {
        id: DefaultTabId,
        icon: "bell",
        panelComponent: DefaultPanelComponent,
      },
      {
        id: "replies",
        icon: "reply",
        panelComponent: "user-menu/replied-notifications-list",
      },
      {
        id: "mentions",
        icon: "at",
        panelComponent: "",
      },
      {
        id: "likes",
        icon: "heart",
        panelComponent: "",
      },
    ];
  }

  get _coreBottomTabs() {
    return [
      {
        id: "preferences",
        icon: "user-cog",
        href: `${this.currentUser.path}/preferences`,
      },
    ];
  }

  @action
  changeTab(tab) {
    if (this.currentTabId !== tab.id) {
      this.currentTabId = tab.id;
      this.currentPanelComponent = tab.panelComponent || DefaultPanelComponent;
    }
  }
}
