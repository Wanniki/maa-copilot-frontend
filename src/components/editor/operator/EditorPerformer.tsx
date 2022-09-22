import { NonIdealState } from '@blueprintjs/core'
import {
  Active,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  Over,
  PointerSensor,
  UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { uniqueId } from 'lodash-es'
import { FC, useEffect, useState } from 'react'
import { Control, useFieldArray, UseFieldArrayMove } from 'react-hook-form'
import { SetRequired } from 'type-fest'
import { useEditableFields } from '../../../utils/useEditableFields'
import { Droppable, Sortable } from '../../dnd'
import { FactItem } from '../../FactItem'
import { EditorGroupItem } from './EditorGroupItem'
import { EditorOperatorItem } from './EditorOperatorItem'
import {
  EditorPerformerAdd,
  EditorPerformerAddProps,
  PerformerType,
} from './EditorPerformerAdd'

type Operator = CopilotDocV1.Operator
type Group = CopilotDocV1.Group

type WithId<T> = T & { _uid: string }

const nonGroupedContainerId = 'nonGrouped'

// generate IDs ourself because useFieldArray will not generate IDs for operators inside group.opers
// TODO: strip IDs away when submitting operation
const idFor = (performer: Operator | Group) => {
  return ((performer as WithId<Operator | Group>)._uid ??= uniqueId())
}

export const EditorPerformer: FC<{
  control: Control<CopilotDocV1.Operation>
}> = ({ control }) => {
  const [editMode, setEditMode] = useState<PerformerType>('operator')
  const sensors = useSensors(useSensor(PointerSensor))

  const {
    fields: _operators,
    append: appendOperator,
    move: moveOperator,
    update: updateOperator,
    remove: removeOperator,
  } = useFieldArray({
    name: 'opers',
    control,
  })

  const {
    fields: _groups,
    append: appendGroup,
    move: moveGroup,
    update: updateGroup,
    remove: removeGroup,
  } = useFieldArray({
    name: 'groups',
    control,
  })

  // upcast them to the base types to stop TS from complaining when calling indexOf(), includes(), etc.
  const operators: Operator[] = _operators
  const groups: Group[] = _groups

  const {
    editingField: editingOperator,
    setEditingField: setEditingOperator,
    reserveEditingField: reserveEditingOperator,
  } = useEditableFields(operators)
  const {
    editingField: editingGroup,
    setEditingField: setEditingGroup,
    reserveEditingField: reserveEditingGroup,
  } = useEditableFields(groups)

  const [draggingOperator, setDraggingOperator] = useState<Operator>()
  const [draggingGroup, setDraggingGroup] = useState<Group>()

  const isOperatorEditing = (operator: Operator) => operator === editingOperator
  const isGroupEditing = (group: Group) => group === editingGroup

  useEffect(() => {
    if (editingOperator) {
      setEditingGroup(undefined)
      setEditMode('operator')
    }
  }, [editingOperator])

  useEffect(() => {
    if (editingGroup) {
      setEditingOperator(undefined)
      setEditMode('group')
    }
  }, [editingGroup])

  const findOperatorById = (id: UniqueIdentifier) =>
    // find operator from operators
    operators.find((op) => idFor(op) === id) ||
    // find operator from inside groups
    groups
      .map(({ opers }) => opers)
      .flat()
      .find((op) => op && idFor(op) === id)

  const findGroupById = (id: UniqueIdentifier) =>
    groups.find((group) => idFor(group) === id)

  const findGroupByOperator = (operator?: Operator) =>
    operator &&
    (groups.find((group) => group.opers?.includes(operator)) as
      | SetRequired<Group, 'opers'>
      | undefined)

  const getType = (item: Active | Over) =>
    item.data.current?.type as 'operator' | 'group'

  const handleDragStart = ({ active }: DragStartEvent) => {
    if (getType(active) === 'operator') {
      setDraggingOperator(findOperatorById(active.id))
    } else {
      setDraggingGroup(findGroupById(active.id))
    }
  }

  const handleDragOver = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) {
      return
    }

    // move operator between groups, or make it non-grouped
    if (getType(active) === 'operator') {
      const operator = findOperatorById(active.id)

      if (operator) {
        const oldGroup = findGroupByOperator(operator)
        const newGroup =
          getType(over) === 'group'
            ? findGroupById(over.id)
            : findGroupByOperator(findOperatorById(over.id))

        if (oldGroup !== newGroup) {
          if (oldGroup) {
            updateGroup(groups.indexOf(oldGroup), {
              ...oldGroup,
              opers: oldGroup.opers?.filter((op) => op !== operator),
            })
          } else {
            removeOperator(operators.indexOf(operator))
          }

          if (newGroup) {
            updateGroup(groups.indexOf(newGroup), {
              ...newGroup,
              opers: [operator, ...(newGroup.opers || [])],
            })
          } else {
            appendOperator(operator)
          }
        }
      }
    }

    // move item
    if (getType(active) === getType(over)) {
      const moveItem = <T extends Group | Operator>(
        items: T[],
        move: UseFieldArrayMove,
      ) => {
        const oldIndex = items.findIndex((item) => idFor(item) === active.id)
        const newIndex = items.findIndex((item) => idFor(item) === over.id)
        if (oldIndex !== -1 && newIndex !== -1) move(oldIndex, newIndex)
      }

      if (getType(active) === 'operator') {
        const operator = findOperatorById(active.id)

        if (operator) {
          const group = findGroupByOperator(operator)

          if (group) {
            moveItem(group.opers, (oldIndex, newIndex) => {
              updateGroup(groups.indexOf(group), {
                ...group,
                opers: arrayMove(group.opers, oldIndex, newIndex),
              })
            })
          } else {
            moveItem(operators, moveOperator)
          }
        }
      } else if (getType(active) === 'group') {
        moveItem(groups, moveGroup)
      }
    }
  }

  const handleDragEnd = () => {
    setDraggingOperator(undefined)
    setDraggingGroup(undefined)
  }

  const submitOperator: EditorPerformerAddProps['submitOperator'] = (
    operator,
    setError,
  ) => {
    if (editingOperator) {
      const existingOperator = findOperatorById(idFor(editingOperator))

      if (existingOperator) {
        const group = findGroupByOperator(existingOperator)

        if (group) {
          const index = groups.indexOf(group)
          const operIndex = group.opers.indexOf(existingOperator)

          // replace existing operator in group
          updateGroup(index, {
            ...group,
            opers: group.opers.map((op) =>
              op === existingOperator ? operator : op,
            ),
          })

          reserveEditingGroup(-1, (updatedGroups) => {
            setEditingOperator(updatedGroups[index]?.opers?.[operIndex])
          })
        } else {
          const index = operators.indexOf(existingOperator)
          updateOperator(index, operator)
          reserveEditingOperator(index)
        }
      }
    } else {
      if (operators.find(({ name }) => name === operator.name)) {
        setError('name', { message: '干员已存在' })
      } else {
        // generate ID before appending or else it'll lose every time the fields are updated
        idFor(operator)

        appendOperator(operator)
      }
    }
  }

  const submitGroup: EditorPerformerAddProps['submitGroup'] = (
    group,
    setError,
  ) => {
    if (editingGroup) {
      const existingGroup = findGroupById(idFor(group))

      if (existingGroup) {
        const index = groups.indexOf(existingGroup)
        updateGroup(index, group)
        reserveEditingGroup(index)
      }
    } else {
      if (groups.find(({ name }) => name === group.name)) {
        setError('name', { message: '干员组已存在' })
      } else {
        // generate ID before appending or else it'll lose every time the fields are updated
        idFor(group)

        appendGroup(group)
      }
    }
  }

  return (
    <>
      <EditorPerformerAdd
        mode={editMode}
        operator={editingOperator}
        group={editingGroup}
        onModeChange={setEditMode}
        onCancel={() => {
          setEditingOperator(undefined)
          setEditingGroup(undefined)
        }}
        submitOperator={submitOperator}
        submitGroup={submitGroup}
      />
      <div className="p-2 -mx-2 relative">
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragEnd}
        >
          <Droppable id={nonGroupedContainerId}>
            <FactItem title="干员" icon="person" className="font-bold" />

            {operators.length === 0 && <NonIdealState title="暂无干员" />}

            <SortableContext
              items={operators.map(idFor)}
              strategy={verticalListSortingStrategy}
            >
              <ul>
                {operators.map((operator) => (
                  <li className="mt-2" key={idFor(operator)}>
                    <Sortable id={idFor(operator)} data={{ type: 'operator' }}>
                      {(attrs) => (
                        <EditorOperatorItem
                          operator={operator}
                          editing={isOperatorEditing(operator)}
                          onEdit={() =>
                            setEditingOperator(
                              isOperatorEditing(operator)
                                ? undefined
                                : operator,
                            )
                          }
                          onRemove={() =>
                            removeOperator(operators.indexOf(operator))
                          }
                          {...attrs}
                        />
                      )}
                    </Sortable>
                  </li>
                ))}
              </ul>
            </SortableContext>
          </Droppable>

          <FactItem title="干员组" icon="people" className="font-bold mt-8" />

          {groups.length === 0 && <NonIdealState title="暂无干员组" />}

          <SortableContext
            items={groups.map(idFor)}
            strategy={verticalListSortingStrategy}
          >
            <ul>
              {groups.map((group) => (
                <li className="mt-2" key={idFor(group)}>
                  <Sortable id={idFor(group)} data={{ type: 'group' }}>
                    {(attrs) => (
                      <EditorGroupItem
                        group={group}
                        editing={isGroupEditing(group)}
                        onEdit={() =>
                          setEditingGroup(
                            isGroupEditing(group) ? undefined : group,
                          )
                        }
                        onRemove={() => removeGroup(groups.indexOf(group))}
                        getOperatorId={idFor}
                        isOperatorEditing={(operator) =>
                          isOperatorEditing(operator)
                        }
                        onOperatorEdit={(operator) =>
                          setEditingOperator(
                            isOperatorEditing(operator) ? undefined : operator,
                          )
                        }
                        onOperatorRemove={(operatorIndexInGroup) => {
                          const groupIndex = groups.indexOf(group)
                          if (operatorIndexInGroup > -1) {
                            group.opers?.splice(operatorIndexInGroup, 1)
                          }
                          updateGroup(groupIndex, group)
                        }}
                        {...attrs}
                      />
                    )}
                  </Sortable>
                </li>
              ))}
            </ul>
          </SortableContext>

          <DragOverlay>
            {draggingOperator && (
              <EditorOperatorItem
                editing={isOperatorEditing(draggingOperator)}
                operator={draggingOperator}
              />
            )}
            {draggingGroup && (
              <EditorGroupItem
                group={draggingGroup}
                editing={isGroupEditing(draggingGroup)}
                isOperatorEditing={isOperatorEditing}
                getOperatorId={idFor}
              />
            )}
          </DragOverlay>
        </DndContext>
      </div>
    </>
  )
}
