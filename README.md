# @astratest/react-native

```tsx
import { AstraTest, AstraTestProvider } from "@astratest/react-native";
AstraTest.start("pk_test_…", { appVersion: "1.4.0" });
export default () => <AstraTestProvider><App /></AstraTestProvider>;
```

Records fetch / XMLHttpRequest calls, console output and uncaught errors. Install `react-native-view-shot` for screenshots; wrap password fields and anything private in `<AstraPrivate>`.
