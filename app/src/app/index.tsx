import { Redirect } from "expo-router";
import { useSession } from "../state/session";

export default function Index() {
  const { account } = useSession();
  return <Redirect href={account ? "/home" : "/welcome"} />;
}
