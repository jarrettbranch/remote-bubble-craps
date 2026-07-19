/*
  ESP32-C3 Bubble Craps dice roller test firmware.

  Protocol over USB serial at 115200 baud:

    PC -> ESP32:
      ROLL <rollId>
      STATUS
      JOG <milliseconds>
      STOP
      FORCE_ON
      FORCE_OFF
      HELP

    ESP32 -> PC:
      ACK <rollId>
      ROLLING <rollId>
      RESULT <rollId> <die1> <die2>
      ERROR <rollId> <message>
      STATUS <state>

  This sketch is intended for bench testing the physical roller actuator.
  It returns simulated dice values after the motor run and settle delay.
  In production, a trusted local gateway should combine this roller command
  with webcam-based dice recognition and send the real result to the backend.

  GPIO 4 is used to drive the optocoupler input for the roller circuit.
  Do not drive a motor, solenoid, or relay coil directly from a GPIO pin.
*/

#include <Arduino.h>
#include <esp_random.h>

// Pin map. GPIO 4 drives the optocoupler input.
static constexpr int ROLLER_ENABLE_PIN = 4;

// Most optocoupler input modules trigger when the GPIO is HIGH. If your
// roller turns on at boot or behaves inverted, change this to false.
static constexpr bool ROLLER_ACTIVE_HIGH = true;

// Set to -1 if your board LED pin is unknown or unavailable.
static constexpr int STATUS_LED_PIN = -1;
static constexpr bool STATUS_LED_ACTIVE_HIGH = true;

// Timing. Tune these for your mechanical roller.
static constexpr uint32_t SERIAL_BAUD = 115200;
static constexpr uint32_t ROLL_MOTOR_MS = 1200;
static constexpr uint32_t DICE_SETTLE_MS = 1500;
static constexpr uint32_t MAX_JOG_MS = 5000;
static constexpr uint32_t IDLE_HEARTBEAT_MS = 5000;
static constexpr size_t MAX_ROLL_ID_LEN = 64;

enum class MachineState {
  Idle,
  RollingMotor,
  Settling,
  Jogging
};

MachineState state = MachineState::Idle;
String activeRollId;
uint32_t phaseEndsAt = 0;
uint32_t nextHeartbeatAt = 0;
String inputLine;
bool serialReady = false;

bool timeReached(uint32_t now, uint32_t target) {
  return static_cast<int32_t>(now - target) >= 0;
}

void writeOutputPin(int pin, bool active, bool activeHigh) {
  if (pin < 0) {
    return;
  }

  digitalWrite(pin, active == activeHigh ? HIGH : LOW);
}

void setRoller(bool active) {
  writeOutputPin(ROLLER_ENABLE_PIN, active, ROLLER_ACTIVE_HIGH);
  writeOutputPin(STATUS_LED_PIN, active, STATUS_LED_ACTIVE_HIGH);

  if (!serialReady) {
    return;
  }

  Serial.print("ROLLER ");
  Serial.print(active ? "ON" : "OFF");
  Serial.print(" pin=");
  Serial.print(ROLLER_ENABLE_PIN);
  Serial.print(" level=");
  Serial.println(active == ROLLER_ACTIVE_HIGH ? "HIGH" : "LOW");
}

const char* stateName() {
  switch (state) {
    case MachineState::Idle:
      return "IDLE";
    case MachineState::RollingMotor:
      return "ROLLING";
    case MachineState::Settling:
      return "SETTLING";
    case MachineState::Jogging:
      return "JOGGING";
  }

  return "UNKNOWN";
}

void printStatus() {
  Serial.print("STATUS ");
  Serial.print(stateName());
  if (activeRollId.length() > 0) {
    Serial.print(" ");
    Serial.print(activeRollId);
  }
  Serial.println();
}

void printHelp() {
  Serial.println("OK commands: ROLL <rollId>, STATUS, JOG <milliseconds>, STOP, FORCE_ON, FORCE_OFF, HELP");
}

bool isValidToken(const String& token) {
  if (token.length() == 0 || token.length() > MAX_ROLL_ID_LEN) {
    return false;
  }

  for (size_t i = 0; i < token.length(); i += 1) {
    char c = token.charAt(i);
    if (c <= ' ' || c == 127) {
      return false;
    }
  }

  return true;
}

void printError(const String& rollId, const char* message) {
  Serial.print("ERROR ");
  Serial.print(rollId.length() > 0 ? rollId : "-");
  Serial.print(" ");
  Serial.println(message);
}

int randomDie() {
  return 1 + static_cast<int>(esp_random() % 6);
}

void startRoll(const String& rollId) {
  if (!isValidToken(rollId)) {
    printError(rollId, "invalid-roll-id");
    return;
  }

  if (state != MachineState::Idle) {
    printError(rollId, "busy");
    return;
  }

  activeRollId = rollId;
  state = MachineState::RollingMotor;
  phaseEndsAt = millis() + ROLL_MOTOR_MS;
  setRoller(true);

  Serial.print("ACK ");
  Serial.println(activeRollId);
  Serial.print("ROLLING ");
  Serial.println(activeRollId);
}

void startJog(uint32_t durationMs) {
  if (durationMs == 0 || durationMs > MAX_JOG_MS) {
    Serial.println("ERROR - invalid-jog-duration");
    return;
  }

  if (state != MachineState::Idle) {
    Serial.println("ERROR - busy");
    return;
  }

  activeRollId = "JOG";
  state = MachineState::Jogging;
  phaseEndsAt = millis() + durationMs;
  setRoller(true);

  Serial.println("ACK JOG");
  Serial.println("ROLLING JOG");
}

void stopMachine(const char* reason) {
  setRoller(false);

  if (state != MachineState::Idle) {
    Serial.print("ERROR ");
    Serial.print(activeRollId.length() > 0 ? activeRollId : "-");
    Serial.print(" ");
    Serial.println(reason);
  }

  state = MachineState::Idle;
  activeRollId = "";
  phaseEndsAt = 0;
}

void completeRoll() {
  int die1 = randomDie();
  int die2 = randomDie();

  Serial.print("RESULT ");
  Serial.print(activeRollId);
  Serial.print(" ");
  Serial.print(die1);
  Serial.print(" ");
  Serial.println(die2);

  state = MachineState::Idle;
  activeRollId = "";
  phaseEndsAt = 0;
}

void updateMachine() {
  uint32_t now = millis();

  if (state == MachineState::Idle && timeReached(now, nextHeartbeatAt)) {
    Serial.println("STATUS IDLE");
    nextHeartbeatAt = now + IDLE_HEARTBEAT_MS;
  }

  if (state == MachineState::RollingMotor && timeReached(now, phaseEndsAt)) {
    setRoller(false);
    state = MachineState::Settling;
    phaseEndsAt = now + DICE_SETTLE_MS;
    return;
  }

  if (state == MachineState::Settling && timeReached(now, phaseEndsAt)) {
    completeRoll();
    return;
  }

  if (state == MachineState::Jogging && timeReached(now, phaseEndsAt)) {
    setRoller(false);
    Serial.println("DONE JOG");
    state = MachineState::Idle;
    activeRollId = "";
    phaseEndsAt = 0;
  }
}

void handleLine(String line) {
  line.trim();
  if (line.length() == 0) {
    return;
  }

  int spaceIndex = line.indexOf(' ');
  String command = spaceIndex >= 0 ? line.substring(0, spaceIndex) : line;
  String argument = spaceIndex >= 0 ? line.substring(spaceIndex + 1) : "";
  command.toUpperCase();
  argument.trim();

  if (command == "ROLL") {
    startRoll(argument);
    return;
  }

  if (command == "STATUS") {
    printStatus();
    return;
  }

  if (command == "JOG") {
    startJog(static_cast<uint32_t>(argument.toInt()));
    return;
  }

  if (command == "STOP") {
    stopMachine("stopped");
    return;
  }

  if (command == "FORCE_ON") {
    state = MachineState::Idle;
    activeRollId = "";
    phaseEndsAt = 0;
    setRoller(true);
    Serial.println("ACK FORCE_ON");
    return;
  }

  if (command == "FORCE_OFF") {
    state = MachineState::Idle;
    activeRollId = "";
    phaseEndsAt = 0;
    setRoller(false);
    Serial.println("ACK FORCE_OFF");
    return;
  }

  if (command == "HELP") {
    printHelp();
    return;
  }

  Serial.print("ERROR - unknown-command ");
  Serial.println(command);
}

void readSerial() {
  while (Serial.available() > 0) {
    char c = static_cast<char>(Serial.read());

    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      handleLine(inputLine);
      inputLine = "";
      continue;
    }

    if (inputLine.length() < 160) {
      inputLine += c;
    } else {
      inputLine = "";
      Serial.println("ERROR - line-too-long");
    }
  }
}

void setup() {
  pinMode(ROLLER_ENABLE_PIN, OUTPUT);
  if (STATUS_LED_PIN >= 0) {
    pinMode(STATUS_LED_PIN, OUTPUT);
  }

  setRoller(false);

  Serial.begin(SERIAL_BAUD);
  serialReady = true;
  delay(250);
  Serial.println("READY esp32-c3-dice-roller");
  printHelp();
  nextHeartbeatAt = millis() + IDLE_HEARTBEAT_MS;
}

void loop() {
  readSerial();
  updateMachine();
}
