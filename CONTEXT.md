# Estelle agent integrations

Estelle capabilities used inside an existing coding agent. This context distinguishes an agent integration from Estelle’s standalone application.

## Language

**Estelle plugin**:
An installable integration that brings Estelle into a supported coding agent, including its automatic workflows and tools.
_Avoid_: Estelle CLI, coding-agent fork

**Estelle CLI**:
Estelle’s standalone terminal application. It is a separate product entry point, not a prerequisite for an Estelle plugin.
_Avoid_: Plugin, hook package

**Estelle host adapter**:
The part of an Estelle integration that translates a coding agent’s session and action events into Estelle’s shared language.
_Avoid_: Separate Estelle backend
