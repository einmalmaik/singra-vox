import en from "../en";
import mergeLocale from "../_shared/mergeLocale";
import app from "./app";
import common from "./common";
import updater from "./updater";
import auth from "./auth";
import settings from "./settings";
import language from "./language";
import setup from "./setup";
import onboarding from "./onboarding";
import invite from "./invite";
import server from "./server";
import channel from "./channel";
import mediaStage from "./mediaStage";
import connect from "./connect";
import notifications from "./notifications";
import errors from "./errors";
import e2ee from "./e2ee";
import search from "./search";
import pinned from "./pinned";
import thread from "./thread";
import dm from "./dm";
import chat from "./chat";
import inviteGenerator from "./inviteGenerator";
import memberList from "./memberList";
import statusMenu from "./statusMenu";
import permissions from "./permissions";
import serverSettings from "./serverSettings";
import svid from "./svid";
import passwordInput from "./passwordInput";

const sections = {
  app,
  common,
  updater,
  auth,
  settings,
  language,
  setup,
  onboarding,
  invite,
  server,
  channel,
  mediaStage,
  connect,
  notifications,
  errors,
  e2ee,
  search,
  pinned,
  thread,
  dm,
  chat,
  inviteGenerator,
  memberList,
  statusMenu,
  permissions,
  serverSettings,
  svid,
  passwordInput,
};

export default mergeLocale(en, sections);
