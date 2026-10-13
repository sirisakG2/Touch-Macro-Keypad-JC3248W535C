// Runs key actions (combos, text, delays, raw down/up) on a background task.
#pragma once
#include "config.h"

void macroBegin();
// Copies the actions and queues them. Returns false when the queue is full.
bool macroRun(const std::vector<Action> &acts);
bool macroBusy();
