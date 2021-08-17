import * as core from "@actions/core";
import { GraphQLClient } from "graphql-request";
import { getSdk } from "./generated/requests";

const operousUrl = "https://app.operous.dev/graphql";
const graphqlClientBase = new GraphQLClient(operousUrl);
const graphqlClient = getSdk(graphqlClientBase);

const trackTestRun = async (serverId, testRunId) => {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const testRun = await graphqlClient
      .server({
        testRunId: testRunId,
        serverId: serverId,
      })
      .then((response) => {
        return response.server.testRun;
      });

    switch (testRun.status) {
      case "FAILED":
      case "SUCCESS":
        return testRun;
      case "RUNNING":
        // Wait 5 seconds to validate if test has ended
        core.info("Waiting test execution completion.");
        await new Promise((resolve) => setTimeout(resolve, 5 * 1000));
        break;
      default:
        throw "Could not verify test run status.";
    }
  }
};

const startTestRun = async (serverId) => {
  return await graphqlClient
    .startTestRun({
      serverId: serverId,
    })
    .then((response) => {
      if (typeof response.startTestRun === "number") {
        core.info("Started test run.");
        return response.startTestRun;
      }
    });
};

const checkToken = async () => {
  return await graphqlClient.checkToken().then((response) => {
    if (
      typeof response.checkToken === "string" &&
      response.checkToken === "Token is valid!"
    ) {
      core.info("Token is valid.");
      return true;
    } else {
      return false;
    }
  });
};

const getAccountServer = async (serverId) => {
  return await graphqlClient.servers().then((response) => {
    if (Array.isArray(response.servers)) {
      const matchedServer = response.servers.filter(
        (server) => server.name === serverId || server.identifier === serverId
      )[0];
      return matchedServer;
    }
  });
};

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export async function main() {
  const hasPassed = [];
  const testsMessages = [];
  const serverIds = core.getInput("serverIds", { required: true }).split(",");
  const accountToken = core.getInput("accountToken", { required: true });

  graphqlClientBase.setHeader("Authorization", `Token ${accountToken}`);

  const isTokenValid = await checkToken();
  if (!isTokenValid) {
    throw "Invalid token. Please verify if the token has expired or been deleted.";
  }

  for (const serverId of serverIds) {
    try {
      const serverData = await getAccountServer(serverId);
      if (!serverData) {
        throw `No server named ${serverId} found on this Operous account.`;
      }

      const testRunId = await startTestRun(serverData.identifier);
      if (!testRunId) {
        throw `Could not start a new Test Run. Verify if the correct parameters were passed.`;
      }

      const testRunData = await trackTestRun(serverId, testRunId);

      const hasConnectivty = testRunData.tests.every(
        (test) => test.passed != null
      );
      if (!hasConnectivty) {
        throw `Operous could not reach the server. Please verify the server ${serverData.name} connectivity.`;
      }

      const testsMessage = testRunData.tests
        .map(
          (test) =>
            `${test.passed ? "✅" : "❌"} ${test.id}: ${test.text.replace(
              "\n",
              ""
            )}`
        )
        .join("\n");

      hasPassed.push(testRunData.tests.every((test) => test.passed === true));

      testsMessages.push(`\n- ${serverData.name} -\n` + testsMessage);
    } catch (error) {
      hasPassed.push(false);
      testsMessages.push(`\n- Server Identifier:  ${serverId} -\n` + error);
    }
  }
  const finalMessage = testsMessages.join("\n");
  if (hasPassed.every((serverRun) => serverRun === true)) {
    core.info(finalMessage);
  } else {
    core.setFailed(finalMessage);
  }
  return finalMessage;
}
