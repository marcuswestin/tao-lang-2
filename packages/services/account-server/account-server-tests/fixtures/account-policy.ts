import type { AccountPolicy } from '../../account-server-src/AccountPolicy'

export const testAccountPolicy: AccountPolicy = {
  accountEntity: 'Account',
  entities: {
    Account: {
      fields: ['DisplayName', 'VerifiedEmail'],
      grants: [{ operations: ['read'], principal: [] }, {
        operations: ['update'],
        principal: [],
        updateFields: ['DisplayName'],
      }],
    },
    Note: {
      fields: ['Owner', 'Body'],
      fieldTypes: { Body: 'text' },
      relations: { Owner: { entity: 'Account' } },
      grants: [{ operations: ['read', 'create', 'delete'], principal: ['Owner'] }, {
        operations: ['update'],
        principal: ['Owner'],
        updateFields: ['Body'],
      }],
    },
    Workspace: {
      fields: ['Owner', 'Title'],
      relations: { Owner: { entity: 'Account' }, Memberships: { entity: 'Membership', inverse: 'Workspace' } },
      grants: [{ operations: ['read'], principal: ['Memberships', 'Person'] }],
    },
    Membership: {
      fields: ['Workspace', 'Person', 'Role'],
      relations: { Workspace: { entity: 'Workspace' }, Person: { entity: 'Account' } },
      unique: [['Workspace', 'Person']],
      grants: [{ operations: ['read'], principal: ['Person'] }, {
        operations: ['create'],
        principal: ['Workspace', 'Owner'],
      }],
    },
  },
}
